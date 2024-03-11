import pdb

import argparse
import torch.nn.functional
from transformers import AutoTokenizer, AutoModelForCausalLM, AutoModelForSeq2SeqLM, AutoConfig
from transformers import T5ForConditionalGeneration, PegasusForConditionalGeneration

from transformers import BitsAndBytesConfig

import os
import pdb

import tiktoken

from openai import OpenAI

from tenacity import (
    retry,
    stop_after_attempt,
    wait_random_exponential,
)  # for exponential backoff


def make_prompt(dp):
    PROMPT_STR = "Based on information from the given document only, answer the question that follows in full sentences."
    input_string = f"{PROMPT_STR} DOCUMENT: {dp['document']}"
    input_string = f"{input_string} QUESTION: {dp['question']} ANSWER:"
    dp["input_string"] = input_string

    return dp



def predict_generation(dp, model: AutoModelForCausalLM, tokenizer, nbeams, max_decode_len, do_sample=False, temperature=1.0, top_p=None, random_seed=1729):
    inputs = tokenizer(dp["input_string"], return_tensors="pt", truncation=False)
    input_ids = inputs.input_ids.to(model.device)
    attention_mask = inputs.attention_mask.to(model.device)


    # pdb.set_trace()
    if do_sample:
        assert nbeams==1
        torch.random.manual_seed(seed=random_seed)

    if type(temperature)!=float:
        temperature = float(temperature)

    gen_output = model.generate(inputs=input_ids,
                                attention_mask = attention_mask,
                                return_dict_in_generate=True,
                                output_scores=False,
                                max_length=input_ids.shape[-1]+max_decode_len,          # have to set again :( cant read from saved model
                                num_beams=nbeams,
                                top_p=top_p,
                                do_sample=do_sample,
                                temperature=temperature,
                                )
    gen_tokids = gen_output["sequences"][0]

    is_encoder_decoder = model.config.is_encoder_decoder

    if not is_encoder_decoder: # trim off the input prompt from the whole output
        old_numtoks = input_ids.shape[-1]
        gen_tokids = gen_tokids[old_numtoks:]

    if gen_tokids[-1].item()==tokenizer.eos_token_id:
        gen_tokids = gen_tokids[:-1]

    gen_string = tokenizer.decode(gen_tokids)

    if type(model)==T5ForConditionalGeneration or type(model)==PegasusForConditionalGeneration:
        gen_string= gen_string.lstrip("<pad>")
        gen_string = gen_string.rstrip("</s>")

    gen_string = gen_string.strip()
    return gen_string



class HFPredictor(object):
    def __init__(self, gpu_idx, model_path, quantize):
        model_name = model_path

        tokenizer = AutoTokenizer.from_pretrained(
            model_name,
            use_fast=False,
        )

        if tokenizer.pad_token==None:
            tokenizer.pad_token = tokenizer.eos_token


        is_encoder_decoder = False
        config = AutoConfig.from_pretrained(model_name)
        if config.is_encoder_decoder:
            is_encoder_decoder = True

        if  is_encoder_decoder:
            model_cls = AutoModelForSeq2SeqLM
        else:
            model_cls = AutoModelForCausalLM


        if quantize=="4bit":
            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16
            )

            model = model_cls.from_pretrained(
                model_name,
                quantization_config=bnb_config,
                device_map={'':gpu_idx}
            )

        elif quantize=="8bit":
            bnb_config = BitsAndBytesConfig(
                load_in_8bit=True,
            )

            model = model_cls.from_pretrained(
                model_name,
                quantization_config=bnb_config,
                device_map={'':gpu_idx}
            )


        elif quantize=="16bit":
            model = model_cls.from_pretrained(
                model_name,
                torch_dtype=torch.bfloat16,
                device_map={'':gpu_idx}
            )


        else:
            print("quanitzation type ", quantize, "not supported!")
            raise NotImplementedError


        model.config.use_cache=True

        self.model = model
        self.tokenizer = tokenizer


    def predict(self, dp, nbeams, max_decode_len, temperature, dosample, top_p):
        pred_str = predict_generation(dp, model=self.model, tokenizer=self.tokenizer, nbeams=nbeams, max_decode_len=max_decode_len, temperature=temperature, do_sample=dosample, top_p=top_p)
        return {"result": pred_str, "success": True}



class OpenaiPredictor(object):
    def __init__(self, model_name):
        self.model_name = model_name
        self.tokenizer = tiktoken.encoding_for_model(model_name)
        self.client = OpenAI(api_key = os.environ["OPENAI_API_KEY"])
    def get_approx_promptlen(self,msgs):
        total_len = 0
        for obj in msgs:
            total_len += len(self.tokenizer.encode(obj["content"]))
        return total_len

    @retry(wait=wait_random_exponential(min=1, max=5), stop=stop_after_attempt(6))
    def get_response(self,msg_list, max_tokens=None):
        response = self.client.chat.completions.create(
            model=self.model_name,
            messages=msg_list,
            max_tokens=max_tokens
                )
        return response.choices[0].message.content

    def predict(self, dp, max_decode_len, **kwargs):
        msglist = [{"role":"user", "content":dp["input_string"]}]
        max_tokens = max_decode_len
        num_toks = self.get_approx_promptlen(msglist)

        if self.model_name=="gpt-3.5-turbo-16k-0613" and num_toks>16000:
            print(f"Sequence length exceeds limit for model {self.model_name}")
            raise AssertionError

        if self.model_name=="gpt-4-0613" and num_toks>8000:
            print(f"Sequence length exceeds limit for model {self.model_name}")
            raise AssertionError

        prediction = self.get_response(msglist, max_tokens)
        return {"result": prediction, "success": True}


class QAModel(object):
    def __init__(self, model_name, gpu_idx=0, quantize="16bit", nbeams=1, max_decode_len=500, temperature=1.0, dosample=True, top_p=0.9):
        parts = model_name.split(":")
        protocol = parts[0]
        model_name = ":".join(parts[1:])

        if protocol=="hf":
            self.model = HFPredictor(gpu_idx=gpu_idx, model_path=model_name, quantize=quantize)
        elif protocol=="oai":
            self.model = OpenaiPredictor(model_name=model_name)
        else:
            print("Unrecognized protocol for initializing QAModel. Should be either hf(huggingface) or oai(OpenAI).")
            raise NotImplementedError

        self.max_decode_len = max_decode_len
        self.temperature = temperature
        self.dosample = dosample
        self.top_p = top_p
        self.nbeams = nbeams


    def predict(self, document, question):
        if type(document)==list:
            document = " ".join(document)
        dp = make_prompt({"document": document, "question": question})

        try:
            return self.model.predict(dp=dp,
                                      max_decode_len=self.max_decode_len,
                                      temperature=self.temperature,
                                      dosample=self.dosample,
                                      top_p=self.top_p,
                                      nbeams=self.nbeams)
        except:
            return {"result":"", "success":False}

