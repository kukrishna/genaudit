import glob
import json
import os

class ExampleGetter():
    def __init__(self, samples_path, save_path):
        self.samples_path = samples_path
        self.save_path = save_path
        self.refresh()

    def refresh(self):
        all_files = glob.glob(f"{self.samples_path}/*.json")
        if self.save_path!="":
            if os.path.exists(self.save_path) and os.path.isdir(self.save_path):
                all_files += glob.glob(f"{self.save_path}/*.json")
            else:
                print(f"ERROR: The given save path is not a valid directory: {self.save_path}")
                raise OSError
        self.full = [json.load(open(x)) for x in all_files]
        self.full = sorted(self.full, key=lambda i:i["id"])
        self.full = [{"input_lines":[], "output_lines":[], "id":"New (empty doc)"}] + self.full

    def get_all_ids(self):
        self.refresh()
        all_ids = [x["id"] for x in self.full]
        return all_ids

    def get_article(self, article_index):
        example: dict = self.full[article_index]
        input_lines = example["input_lines"]
        output_lines = example["output_lines"]

        return_obj = {
            "input_lines": input_lines,
            "id": example["id"],
            "output_lines": output_lines,
        }

        if "question" in example:
            return_obj["question"] = example["question"]

        return return_obj

