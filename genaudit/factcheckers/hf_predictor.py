from transformers import AutoTokenizer, AutoModelForSeq2SeqLM, AutoConfig, AutoModelForCausalLM
import torch.nn.functional
from transformers import BitsAndBytesConfig
from peft import PeftModel
from peft import PeftConfig


class HFPredictor(object):
    def __init__(self, model_name, gpu_idx=0, nbeams=4, max_decode_len=999):

        adapter_config = PeftConfig.from_pretrained(model_name)
        base_model_name_or_path = adapter_config.base_model_name_or_path

        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16
        )

        tokenizer = AutoTokenizer.from_pretrained(
            base_model_name_or_path,
            use_fast=False
        )

        if tokenizer.pad_token==None:
            tokenizer.pad_token = tokenizer.eos_token


        is_encoder_decoder = False
        config = AutoConfig.from_pretrained(base_model_name_or_path)
        if config.is_encoder_decoder:
            is_encoder_decoder = True

        if  is_encoder_decoder:
            model_cls = AutoModelForSeq2SeqLM
        else:
            model_cls = AutoModelForCausalLM

        model = model_cls.from_pretrained(
            base_model_name_or_path,
            quantization_config=bnb_config,
            device_map={'':gpu_idx}
        )

        model.config.use_cache=True

        mdl2 = PeftModel.from_pretrained(model,
                                         model_name,
                                         torch_dtype=torch.bfloat16,
                                         device_map={'':gpu_idx})
        model.gradient_checkpointing_disable()
        mdl2.gradient_checkpointing_disable()

        self.model = mdl2
        self.is_encoder_decoder = model.config.is_encoder_decoder
        self.tokenizer = tokenizer
        self.max_decode_len = max_decode_len
        self.nbeams = nbeams


    def preprocess(self, dp):
        PROMPT_STR = "You are provided a document and its summary. The summary may potentially contain factual errors. The last sentence of the summary is marked as a claim. Find all sentences in the document providing evidence for the claim, and then revise the claim to remove or replace unsupported facts."
        input_string = f"{PROMPT_STR} DOCUMENT:"
        for _i,sent in enumerate(dp["input_lines"]):
            input_string = f"{input_string} SENT{_i} {sent}"

        input_string = f"{input_string} SUMMARY:"
        for _k, sent in enumerate(dp["prev_summ_lines"]):
            input_string = f"{input_string} {sent}"

        input_string = f"{input_string} CLAIM: {dp['before_summary_sent']}"
        output_string = ""

        if self.is_encoder_decoder:
            output_string = f"EVIDENCE:"
        else:
            input_string = f"{input_string} EVIDENCE:"

        for ev_idx in dp["evidence_labels"]:
            output_string = f"{output_string} SENT{ev_idx}"
        output_string = f"{output_string} REVISION: {dp['after_summary_sent']}"

        input_string = input_string.strip()
        output_string = output_string.strip()

        dp["input_string"] = input_string
        dp["output_string"] = output_string

        return dp


    def generate(self, dp, model: AutoModelForSeq2SeqLM, tokenizer, nbeams, max_decode_len):

        inputs = tokenizer(dp["input_string"], return_tensors="pt", truncation=False)
        input_ids = inputs.input_ids.cuda()

        if not model.config.is_encoder_decoder:
            max_decode_len = max_decode_len+input_ids.shape[-1] # because the param for causal LMs includes input tokens into length too

        gen_output = model.generate(inputs=input_ids,
                                    return_dict_in_generate=True,
                                    decoder_input_ids=None,
                                    output_scores=False,
                                    max_length=max_decode_len,
                                    num_beams=nbeams)

        gen_tokids = gen_output["sequences"][0]

        if not model.config.is_encoder_decoder:
            gen_tokids = gen_tokids[input_ids.shape[-1]:]   # it puts the input string in it too if the model is causallm

        if gen_tokids[0]==tokenizer.pad_token_id:
            gen_tokids = gen_tokids[1:] # first token is pad in t5 generations for eg

        if gen_tokids[-1].item()==tokenizer.eos_token_id:
            gen_tokids = gen_tokids[:-1]

        gen_string = tokenizer.decode(gen_tokids)
        return gen_string



    def predict(self, dp):
        newdp = self.preprocess(dp)
        pred_str = self.generate(newdp,
                      model=self.model,
                      tokenizer=self.tokenizer,
                      nbeams=self.nbeams,
                      max_decode_len=self.max_decode_len)
        if not self.is_encoder_decoder:
            # for decoder-only models, the word EVIDENCE: is not generated and so has to be prepended again.
            # for enc-dec models it is generated by the model
            pred_str = f"EVIDENCE: {pred_str}"
        return pred_str

