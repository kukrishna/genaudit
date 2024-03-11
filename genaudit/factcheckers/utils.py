import difflib
from nltk.tokenize import TreebankWordTokenizer as twt
from collections import defaultdict
import pdb

def showdiff(fr, to, replace_empty=False):
    differ = difflib.Differ()

    fr_wordspans = list(twt().span_tokenize(fr))
    to_wordspans = list(twt().span_tokenize(to))

    fr_words = []
    last_endpos = 0
    for onespan in fr_wordspans:
        fr_words.append(fr[last_endpos:onespan[1]])
        last_endpos = onespan[1]

    to_words = []
    last_endpos = 0
    for onespan in to_wordspans:
        to_words.append(to[last_endpos:onespan[1]])
        last_endpos = onespan[1]

    line = ""
    deleteonly_line = ""
    normal_spans = []
    deleted_spans = []
    added_spans = []
    deleteonly_spans = []
    addonly_insertionmap = defaultdict(str)

    entries = list(differ.compare(fr_words, to_words))

    entries = [e for e in entries if e[0]!="?"]

    # this loop rearranges words in the diff such that the additions come after deletions
    # this loop is guaranteed to terminate because at each iteration, we either advance one + over - (like checkers) or exit the subroutine
    # since there are limited number of -s that can be hopped over, we will terminate
    # time complexity is O(n^2) but modern computers are fast enough for this
    while True:
        swapped_something = False
        for i in range(len(entries)-1):
            if entries[i][0]=="+" and entries[i+1][0]=="-":
                #swap
                temp = entries[i]
                entries[i] = entries[i+1]
                entries[i+1] = temp
                swapped_something = True
                break
        if not swapped_something:
            break

    for entry in entries:
        if entry[0]=="+":
            text = entry[2:]
            start_idx = len(line)
            end_index = start_idx+len(text)

            if len(deleted_spans)>0 and deleted_spans[-1][1]==start_idx:
                # this means we are at the start of a potentially multi-word addition
                addonly_insertionmap[deleteonly_spans[-1][1]] += text
            elif len(added_spans)>0 and added_spans[-1][1]==start_idx:
                # this means we are at word_idx>=1 of a multi-word addition. so just expand the last addition.
                addonly_insertionmap[deleteonly_spans[-1][1]] += text
            else:
                # this means it is a new addition. we can just add to an empty span and basically replace the empty string into something new
                start_idx = len(deleteonly_line)
                deleteonly_spans.append((start_idx, start_idx))
                addonly_insertionmap[deleteonly_spans[-1][1]] += text

            added_spans.append((start_idx, end_index))
            line+=text



        elif entry[0]=="-":
            text = entry[2:]
            start_idx = len(line)
            end_index = start_idx+len(text)
            deleted_spans.append((start_idx, end_index))
            line+=text

            start_idx = len(deleteonly_line)
            end_index = start_idx+len(text)
            deleteonly_spans.append((start_idx, end_index))
            deleteonly_line+=text

        else:
            text = entry[2:]
            start_idx = len(line)
            end_index = start_idx+len(text)
            normal_spans.append((start_idx, end_index))
            line+=text

            start_idx = len(deleteonly_line)
            end_index = start_idx+len(text)
            deleteonly_line+=text

    if not replace_empty:
        new_deleteonly_spans = []
        for (l,r) in deleteonly_spans:
            if l==r:
                del addonly_insertionmap[r]
            else:
                new_deleteonly_spans.append((l,r))

    return {
        "line": line,
        "normal_spans": normal_spans,
        "deleted_spans": deleted_spans,
        "added_spans": added_spans,
        "deleteonly_line": deleteonly_line,
        "deleteonly_spans": deleteonly_spans,
        "addonly_insertionmap": addonly_insertionmap
    }


def get_shift(summary_line, fixed_output, allow_additions=False):

    diff_bw_two = showdiff(fr=summary_line, to=fixed_output, replace_empty=allow_additions)
    todelete_spans = diff_bw_two["deleteonly_spans"]
    addonly_insertionmap = diff_bw_two["addonly_insertionmap"]


    # converting from tuples to list to modify
    todelete_spans = [list(x) for x in todelete_spans]

    replacement_strings = []
    for onespan in todelete_spans:
        endpos = onespan[-1]
        if endpos in addonly_insertionmap:
            replacement_strings.append(addonly_insertionmap[endpos])
        else:
            replacement_strings.append("")


    # filter the replacements to disallow certain ones that are problematic (e.g. unks, only spaces)
    filtered_todelete_spans = []
    filtered_replacement_strings = []
    for (onespan, repstr) in zip(todelete_spans, replacement_strings):
        # if unk then skip
        if "<unk>" in repstr:
            # print("FILTER ALERT: skipped replacement of ", repstr)
            continue

        # if the difference is only whitespace then skip
        l,r = onespan
        before_str = summary_line[l:r]
        if before_str.strip()==repstr.strip():
            # print(f"FILTER ALERT: skipped replacement which is identical except whitespace *{before_str}* *{repstr}*")
            continue

        filtered_todelete_spans.append(onespan)
        filtered_replacement_strings.append(repstr)


    todelete_spans = filtered_todelete_spans
    replacement_strings = filtered_replacement_strings


    fused_todelete_spans = []
    fused_replacement_strings = []
    for (onespan, repl) in zip(todelete_spans, replacement_strings):
        if len(fused_todelete_spans)==0 or onespan[0]!=fused_todelete_spans[-1][1]:
            fused_todelete_spans.append(onespan)
            fused_replacement_strings.append(repl)
        else:
            fused_todelete_spans[-1][1] = onespan[1]
            fused_replacement_strings[-1] += repl

    assert len(fused_todelete_spans)==len(fused_replacement_strings)

    return {"summary_line": summary_line,
            "todelete_spans": fused_todelete_spans,
            "replacement_strings": fused_replacement_strings}
