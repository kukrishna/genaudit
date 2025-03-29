<img src="https://genaudit.org/tutorial/resource_files/logo.png" width="100">

# GenAudit

GenAudit is a tool designed to help in fact-checking LLM-generated text against reference documents. GenAudit suggests edits to LLM responses by revising or removing claims that are not supported by the reference document, and also presents evidence from the reference for facts that do appear to have support.

To view more details on how to use the system and see sample outputs, please visit https://genaudit.org/

For technical details, please read the paper: https://arxiv.org/abs/2402.12566

## Installation

GenAudit can be installed via PyPi with the command `pip install genaudit`
You need to use python version 3.9 to install and use this package.
You can then use the tool via an interactive interface, or via a the library's API in your Python code.

## Running the interactive tool 

You can use GenAudit by starting a server by running the shell commands given below.
Some notable parameters are:

```shell
--port "port to use for listening to requests"
--factcheck-model "model to use for fact-checking claims"
--num-factcheck-processes "can spawn multiple models for factchecking sentences in parallel. useful if you have multiple gpus."
--use-single-gpu (optional)  "if you want all models to be loaded on the same GPU, use this flag. Otherwise, each model is loaded on a different GPU."
--qa-model (optional) "model to use for answering questions. if not specified, the interface will start without QA model. You can still use the fact-checking features."
--qa-quantize (optional) "quantization to use for the QA model (should be one of: 16bit/8bit/4bit)"
--save-path (optional) "path to a directory for saving data (reference doc, questions, and responses after potential editing)."
```

For example, the command below would start a server with a fine-tuned FlanUL2 model for fact-checking (3 copies running in parallel), and Mistral-7B model for QA with 4bit quantization.

```shell
  # if you have 4 gpus to use
  python -m genaudit.launch --port 7000 --qa-model hf:tiiuae/falcon-7b-instruct \
    --factcheck-model hf:kundank/genaudit-usb-flanul2 --num-factcheck-processes 3 \
    --qa-quantize 4bit
    
  # Access the tool by visiting http://localhost:7000/
```

Depending on the GPU memory available, you may want to use a smaller fact-checking model.
See https://genaudit.org to see the other fact-checking models available.

More examples:

```shell
 # if you have single gpu (both models loaded on the same gpu)
  python -m genaudit.launch --port <port-value> --qa-model hf:tiiuae/falcon-7b-instruct \
    --factcheck-model hf:kundank/genaudit-usb-flanul2 --num-factcheck-processes 1 \
    --use-single-gpu --qa-quantize 4bit

  # using OpenAI models for QA (e.g. gpt-3.5-turbo)
  python -m genaudit.launch --port <port-value> --qa-model oai:gpt-3.5-turbo-16k-0613  \
    --factcheck-model hf:kundank/genaudit-usb-flanul2 --num-factcheck-processes 1 --use-single-gpu
```


## API usage

You can easily invoke genaudit in your Python script to factcheck claims against reference. We show an example below:

```python
from genaudit import FactChecker
fc = FactChecker("hf:kundank/genaudit-usb-flanul2")


ref = '''Carnegie Mellon University (CMU) is a private research university in Pittsburgh, Pennsylvania. \
The institution was formed by a merger of Carnegie Institute of Technology and Mellon Institute \
of Industrial Research in 1967. In the 1990s and into the 2000s, Carnegie Mellon solidified its \
status among American universities, consistently ranking in the top 25. In 2018, Carnegie Mellon's \
Tepper School of Business placed 12th in an annual ranking of U.S. business schools by Bloomberg Businessweek.'''

gen = "CMU is a top-ranked university located in Pittsburgh. It was formed by merging Carnegie Institute \
of Technology, Mellon Institute of Industrial Research, and the Cranberry Lemon Institute. Its business school \
was ranked 15th in the US by Bloomberg Businessweek."

fc.check(reference=ref, claim=gen)

######################
####### Output #######
######################
{'reference_sents': ['Carnegie Mellon University (CMU) is a private research university in Pittsburgh, Pennsylvania.',
  'The institution was formed by a merger of Carnegie Institute of Technology and Mellon Institute of Industrial Research in 1967.',
  'In the 1990s and into the 2000s, Carnegie Mellon solidified its status among American universities, consistently ranking in the top 25.',
  "In 2018, Carnegie Mellon's Tepper School of Business placed 12th in an annual ranking of U.S. business schools by Bloomberg Businessweek."],
 'claim_sents': [{'evidence_labels': [0, 2],
   'todelete_spans': [],
   'replacement_strings': [],
   'txt': 'CMU is a top-ranked university located in Pittsburgh.',
   'success': True,
   'edited_txt': 'CMU is a top-ranked university located in Pittsburgh.'},
  {'evidence_labels': [1],
   'todelete_spans': [[57, 58], [98, 133]],
   'replacement_strings': [' and', ''],
   'txt': 'It was formed by merging Carnegie Institute of Technology, Mellon Institute of Industrial Research, and the Cranberry Lemon Institute.',
   'success': True,
   'edited_txt': 'It was formed by merging Carnegie Institute of Technology and Mellon Institute of Industrial Research.'},
  {'evidence_labels': [3],
   'todelete_spans': [[30, 35]],
   'replacement_strings': [' 12th'],
   'txt': 'Its business school was ranked 15th in the US by Bloomberg Businessweek.',
   'success': True,
   'edited_txt': 'Its business school was ranked 12th in the US by Bloomberg Businessweek.'}]}
```



## Citation

If you use our tool, please cite it as given below:

```
@article{krishna2024genaudit,
  title={GenAudit: Fixing Factual Errors in Language Model Outputs with Evidence},
  author={Krishna, Kundan and Ramprasad, Sanjana and Gupta, Prakhar and Wallace, Byron C and Lipton, Zachary C and Bigham, Jeffrey P},
  journal={arXiv preprint arXiv:2402.12566},
  year={2024}
}
```
