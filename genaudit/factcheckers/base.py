from .utils import get_shift
from .hf_predictor import HFPredictor
import spacy


class FactChecker(object):
    def __init__(self, model_name, allow_additions=False, distributed=False, **kwargs):
        self.allow_additions = allow_additions

        parts = model_name.split(":")
        protocol = parts[0]
        model_name = ":".join(parts[1:])

        if protocol == "hf":
            self.model = HFPredictor(
                model_name=model_name, distributed=distributed, **kwargs
            )
        else:
            print(
                "Unrecognized protocol passed for factchecking model. Currently supported protocols are: hf(huggingface)"
            )
            raise NotImplementedError

        try:
            self.nlp = spacy.load("en_core_web_md")
        except:
            # if model not found then download it
            from spacy.cli import download

            download("en_core_web_md")
            self.nlp = spacy.load("en_core_web_md")

    def sent_tokenize(self, s):
        s = s.replace("\n", " ").strip()
        doc = self.nlp(s)
        sents = [str(s) for s in doc.sents]
        return sents

    def check(self, reference, claim):
        """
        Function to factcheck claim against reference document.
        :param reference: Text from the reference document. Could be a string or a list containing its sentences in sequence.
        :param claim: The claim to be fact-checked. Could be a string or a list representing its sentence-tokenized form.
        :return: A dictionary containing:
            1. reference_sents: List of sentences in the reference
            2. claim_sents: A list containing an object for each sentence in the claim, where the object contains the following fields:
                (a) txt: The text in the given claim sentence.
                (b) success: Whether the fact-checking model run successfully on this sentence (sometimes it fails because the output could not be parsed correctly). Subsequent fields are present only if value of success is True.
                (c) evidence_labels: Indices of sentences from the reference that provide evidence for facts in this claim sentence.
                (d) todelete_spans: A list of spans to be removed from the text (in terms of character indices).
                (e) replacement_strings: A list of strings of the same length as (d), representing text that should be put in place of each corresponding deleted span (an empty string represents deletion without any replacement).
                (f) fixed_txt: An edited version of the sentence after fixing any errors.
        """
        if type(reference) == str:
            reference_sents = self.sent_tokenize(reference)
        elif type(reference) == list:
            reference_sents = reference
        else:
            raise NotImplementedError(
                "Unknown type for reference. Must be either a string or a list of strings (each a sentence)"
            )

        if type(claim) == str:
            claim_sents = self.sent_tokenize(claim)
        elif type(claim) == list:
            claim_sents = claim
        else:
            raise NotImplementedError(
                "Unknown type for claim. Must be either a string or a list of strings (each a sentence)"
            )

        results = {"reference_sents": reference_sents, "claim_sents": []}
        for j, claimsent in enumerate(claim_sents):
            output = self.predict(reference_sents, claimsent, claim_sents[:j])
            if not output["success"]:
                results["claim_sents"].append({"txt": claimsent, "success": False})
            else:
                res = output["result"]
                res["txt"] = claimsent
                res["success"] = True

                # apply the edits
                revision = claimsent
                offset = 0
                for delspan, repl in zip(
                    res["todelete_spans"], res["replacement_strings"]
                ):
                    l, r = delspan
                    l += offset
                    r += offset
                    revision = revision[:l] + repl + revision[r:]
                    offset = offset - (r - l) + len(repl)

                res["edited_txt"] = revision

                results["claim_sents"].append(res)

        return results

    def predict(self, reference_sents, claim, prev_sents=None):
        if prev_sents is None:
            prev_sents = []

        # the whitespaces are stripped before feeding into the model. The offset needs to be compensated later when returning the spans to delete.
        num_frontspaces = len(claim) - len(claim.lstrip())
        claim = claim.strip()

        dp = {
            "input_lines": reference_sents,
            "before_summary_sent": claim,
            "prev_summ_lines": prev_sents,
            "after_summary_sent": "dummmy",
            "id": "xxxxx",
            "evidence_labels": [0],
        }

        try:
            output = self.model.predict(dp)

            fixed_output = output.split("REVISION:")[1].strip()
            ev_sentids = output.split("REVISION:")[0].split("EVIDENCE: ")[1].strip()

            ev_labels = []
            for one_sentid in ev_sentids.split(" "):
                this_idx = one_sentid.split("SENT")[-1]
                try:
                    ev_labels.append(int(this_idx))
                except:
                    # this will happen if no evidence was predicted or if the outputs were badly formatted
                    continue

            diff = get_shift(
                summary_line=claim,
                fixed_output=fixed_output,
                allow_additions=self.allow_additions,
            )

            result = {
                "evidence_labels": ev_labels,
                "todelete_spans": diff["todelete_spans"],
                "replacement_strings": diff["replacement_strings"],
            }

            # adjust for the spaces at the beginning
            todelete_spans = result["todelete_spans"]
            for j in range(len(todelete_spans)):
                todelete_spans[j][0] += num_frontspaces
                todelete_spans[j][1] += num_frontspaces

            return {"result": result, "success": True}

        except:
            # need to always return something in case there is an error. else threads waiting for it in the frontend code will stall forever
            result = {
                "evidence_labels": [],
                "todelete_spans": [],
                "replacement_strings": [],
            }
            return {"result": result, "success": False}
