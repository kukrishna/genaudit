import argparse
import os
import json
from bottle import Bottle, request, response, run, static_file
import bottle
from paste import httpserver
import time
import threading
from torch.multiprocessing import Process, Queue, set_start_method, Event
import torch
from .factcheckers import FactChecker
from .qa_models import QAModel
from .get_example import ExampleGetter
import spacy

bottle.BaseRequest.MEMFILE_MAX = 10240000

web_root = f"{os.path.dirname(__file__)}/webroot/"
samples_path = f"{os.path.dirname(__file__)}/examples/saved"

def consumer_procroot(pidx, cls, args_dict, in_queue: Queue, res_queue: Queue, init_event:Event):
    fc = cls(**args_dict)
    init_event.set()

    while True:
        inp = in_queue.get(block=True)
        key = inp["key"]
        payload = inp["payload"]
        result = fc.predict(**payload)
        had_success = result["success"]
        if not had_success:
            print("WARNING: FAILED A PREDICTION")

        res_queue.put({"key": key, "payload":result})


def manager_threadroot(lockdict, res_queue: Queue, results_dict):
    while True:
        out = res_queue.get(block=True)
        key = out["key"]
        results_dict[key] = out["payload"]
        assert key in lockdict
        event = lockdict[key]
        event.set()


if __name__ == "__main__":

    parser = argparse.ArgumentParser(description='frontend server for genaudit')

    parser.add_argument("--bind", type=str, default="localhost", help="the interface to bind to")
    parser.add_argument("--port", type=int, required=True, help="port to use for listening to requests")
    parser.add_argument("--qa-model", type=str, default="", help="model to use for answering questions (optional)")
    parser.add_argument("--factcheck-model", type=str, required=True, help="model to use for fact-checking claims")
    parser.add_argument("--num-factcheck-processes", type=int, default=1, help="can spawn multiple models for factchecking sentences in parallel. useful if you have multiple gpus.")
    parser.add_argument("--max-doc-words", type=int, default=1500, help="maximum number of words allowed in the input. note that no truncation happens when doing fact-checking or QA. Set according to available GPU memory.")
    parser.add_argument("--fc-max-decode-len", type=int, default=250, help="maximum output length for the fact-checking model. should be set to around the expected maximum length of a sentence being factchecked.")
    parser.add_argument("--fc-nbeams", type=int, default=4, help="number of beams to use while decoding with the fact-checking model")
    parser.add_argument("--qa-max-decode-len", type=int, default=500, help="maximum number of tokens to generate while answering questions with the QA model")
    parser.add_argument("--qa-dosample", action="store_true", help="whether to use sampling while generating response from the QA model")
    parser.add_argument("--qa-temperature", type=float, default=1.0, help="temperature used while sampling from the QA model")
    parser.add_argument("--qa-nbeams", type=int, default=1, help="number of beams to use while decoding from the QA model")
    parser.add_argument("--qa-top-p", type=float, default=None, help="the value of p in the top-p sampling procedure with the QA model")
    parser.add_argument("--qa-quantize", type=str, default="16bit", help="quantization to use for the QA model (should be one of: 16bit/8bit/4bit)")
    parser.add_argument("--use-single-gpu", action="store_true", help="if you want all models to be loaded on the same GPU, use this flag. Otherwise, each model is loaded on a different GPU.")
    parser.add_argument("--save-path", type=str, default="", help="path to a directory for saving data (reference doc, questions, and responses after potential editing).")


    args = parser.parse_args()


    set_start_method('spawn')


    ex_getter = ExampleGetter(samples_path=samples_path, save_path=args.save_path)
    app = Bottle()


    try:
        nlp = spacy.load("en_core_web_md")
    except:
        # if model not found then download it
        from spacy.cli import download
        download("en_core_web_md")
        nlp = spacy.load("en_core_web_md")


    gpu_counter = 0

    input_queue = Queue()
    result_queue = Queue()
    results_dict = {}

    fc_towait_events = []

    for pidx in range(args.num_factcheck_processes):
        init_event = Event()
        fc_towait_events.append(init_event)
        constructor_args = {
            "model_name":args.factcheck_model,
            "gpu_idx": gpu_counter,
            "nbeams": args.fc_nbeams,
            "max_decode_len": args.fc_max_decode_len,
        }
        proc = torch.multiprocessing.Process(target=consumer_procroot, args=(pidx, FactChecker, constructor_args , input_queue, result_queue, init_event))
        proc.start()
        if not args.use_single_gpu:
            gpu_counter+=1

    [ev.wait() for ev in fc_towait_events]
    print("Fact-checking models started. 🏁")

    lockdict = {}
    manager_thread = threading.Thread(target=manager_threadroot, args=(lockdict,result_queue, results_dict))
    manager_thread.start()

    qa_model_available = args.qa_model!=""

    input_queue2 = Queue()
    result_queue2 = Queue()
    results_dict2 = {}
    lockdict2 = {}
    init_event2 = Event()

    if qa_model_available:
        constructor_args = {
            "model_name":args.qa_model,
            "gpu_idx": gpu_counter,
            "temperature":args.qa_temperature,
            "top_p":args.qa_top_p,
            "dosample": args.qa_dosample,
            "max_decode_len": args.qa_max_decode_len,
            "quantize": args.qa_quantize,
            "nbeams": args.qa_nbeams
        }
        proc2 = torch.multiprocessing.Process(target=consumer_procroot, args=(0, QAModel, constructor_args , input_queue2, result_queue2, init_event2))
        proc2.start()
        manager_thread2 = threading.Thread(target=manager_threadroot, args=(lockdict2,result_queue2, results_dict2))
        manager_thread2.start()

        init_event2.wait()
        print("QA model started. 🏁")


    @app.hook('after_request')
    def enable_cors():
        """
        You need to add some headers to each request.
        Don't use the wildcard '*' for Access-Control-Allow-Origin in production.
        """
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'PUT, GET, POST, DELETE, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Origin, Accept, Content-Type, X-Requested-With, X-CSRF-Token'


    @app.route('/')
    def serve_job():
        html_str = open(os.path.join(web_root,"index.html")).read()
        return html_str

    @app.route('/get_config', method=['GET'])
    def get_config():
        return {
            "factcheck_model":  {
                                "model_name_or_path": args.factcheck_model,
                                "num_procs": args.num_factcheck_processes
                                },
            "qa_model": {
                                "model_name_or_path": args.qa_model,
                                "quantization": args.qa_quantize,
                                "max_decode_len": args.qa_max_decode_len,
                        },
            "max_doc_words": args.max_doc_words,
            "save_path": args.save_path
        }

    @app.route('/get_all_ids', method=['GET'])
    def get_all_ids():
        output = [{"label": x, "val":j} for (j,x) in enumerate(ex_getter.get_all_ids())]
        return {"all_ids": output}

    @app.route('/static/<filename:path>')
    def send_static(filename):
        return static_file(filename, root=web_root)


    @app.route('/get_example/<jobid>')
    def get_example(jobid):
        jobid = int(jobid)
        one_dp = ex_getter.get_article(jobid)

        return_obj_formatted = {}
        return_obj_formatted["job_id"] = one_dp["id"]
        return_obj_formatted["input_lines"] = one_dp["input_lines"]
        return_obj_formatted["output_lines"] = one_dp["output_lines"]

        for i in range(len(return_obj_formatted["input_lines"])):
            return_obj_formatted["input_lines"][i] = return_obj_formatted["input_lines"][i].strip()

        for i in range(len(return_obj_formatted["output_lines"])):
            return_obj_formatted["output_lines"][i] = return_obj_formatted["output_lines"][i].strip()

        if "question" in one_dp:
            return_obj_formatted["question"] = one_dp["question"]

        return return_obj_formatted


    @app.route('/get_qa', method=['POST'])
    def get_qa():

        if not qa_model_available:
            return {"success": False, "reason": "QA model not running."}

        bundle = request.forms.get("bundle")
        bytes_string = bytes(bundle, encoding="raw_unicode_escape")
        bundle = bytes_string.decode("utf-8", "strict")
        bundle = json.loads(bundle)

        article_lines = bundle["article_lines"]
        question = bundle["question"]
        article_lines = [x["txt"] for x in article_lines]


        send_dp = {
            "document": article_lines,
            "question": question
        }

        curtime = str(time.time())
        event = threading.Event()
        lockdict2[curtime] = event
        input_queue2.put({"key": curtime, "payload": send_dp})

        event.wait()

        del lockdict2[curtime]
        recv_pred = results_dict2.pop(curtime)
        qa_output =  recv_pred["result"]

        qa_output = qa_output.replace("\n", " ").strip()
        doc = nlp(qa_output)
        sents = [str(s) for s in doc.sents]

        return {"success": True, "prediction": sents}

    @app.route('/get_ev_with_fixfactuality', method=['POST'])
    def get_factuality():

        bundle = request.forms.get("bundle")
        bytes_string = bytes(bundle, encoding="raw_unicode_escape")
        bundle = bytes_string.decode("utf-8", "strict")
        bundle = json.loads(bundle)

        article_lines = bundle["article_lines"]
        summary_line = bundle["summary_line"]
        prev_lines = bundle["prev_lines"]

        article_lines = [x["txt"] for x in article_lines]

        send_dp = {
            "reference_sents": article_lines,
            "claim": summary_line,
            "prev_sents": prev_lines
        }

        curtime = str(time.time())
        event = threading.Event()
        lockdict[curtime] = event
        input_queue.put({"key": curtime, "payload": send_dp})

        event.wait()

        del lockdict[curtime]
        recv_pred = results_dict.pop(curtime)
        fc_output = recv_pred["result"]

        return fc_output


    @app.route('/save_example', method=['POST'])
    def save_example():

        if args.save_path=="":
            return {'success': False, 'reason': 'The path to save examples has not been declared. Aborting...'}

        bundle_str = request.forms.get("bundle")
        bytes_string = bytes(bundle_str, encoding="raw_unicode_escape")
        bundle_str = bytes_string.decode("utf-8", "strict")

        save_obj = json.loads(bundle_str)

        _id = save_obj["id"]


        output_fpath = f"{args.save_path}/{_id}.json"

        if os.path.exists(output_fpath):
            return {'success': False, 'reason': 'Object already exists with that ID'}

        else:
            with open(output_fpath, "w", encoding="utf-8") as w:
                json.dump(save_obj, w, ensure_ascii=False)
            return {'success': True, 'reason': 'Object saved successfully'}


    @app.route("/sent_tokenize", method=['POST'])
    def sent_tokenize():
        new_doc = request.forms.get("doc")
        bytes_string = bytes(new_doc, encoding="raw_unicode_escape")
        new_doc = bytes_string.decode("utf-8", "strict")
        new_doc = new_doc.strip()
        new_doc = new_doc.replace("\n"," ")
        doc = nlp(new_doc)
        sents = [str(s) for s in doc.sents]

        newtxt = "\n".join(sents)

        return {"prediction":newtxt}

    @app.route("/check_length", method=['POST'])
    def check_length():
        new_doc = request.forms.get("doc")
        bytes_string = bytes(new_doc, encoding="raw_unicode_escape")
        new_doc = bytes_string.decode("utf-8", "strict")
        new_doc = new_doc.strip()
        new_doc = new_doc.replace("\n"," ")
        doc = nlp(new_doc)
        curr_len = len(doc)

        to_return = {"curr_len":curr_len, "allowed_len":args.max_doc_words, "okay": curr_len<=args.max_doc_words}

        return to_return


    httpserver.serve(app, host=args.bind, port=args.port)


