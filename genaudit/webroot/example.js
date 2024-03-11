
// taken from https://gist.github.com/Gericop/e33be1f201cf242197d9c4d0a1fa7335
function Semaphore(max) {
  var counter = 0;
  var waiting = [];

  var take = function() {
    if (waiting.length > 0 && counter < max){
      counter++;
      let promise = waiting.shift();
      promise.resolve();
    }
  }

  this.acquire = function() {
    if(counter < max) {
      counter++
      return new Promise(resolve => {
      resolve();
    });
    } else {
      return new Promise((resolve, err) => {
        waiting.push({resolve: resolve, err: err});
      });
    }
  }

  this.release = function() {
   counter--;
   take();
  }

  this.purge = function() {
    let unresolved = waiting.length;

    for (let i = 0; i < unresolved; i++) {
      waiting[i].err('Task has been purged.');
    }

    counter = 0;
    waiting = [];

    return unresolved;
  }
}


// taken from codemirror
function elt(tag, content, className, style) {
    var e = document.createElement(tag);
    if (className) { e.className = className; }
    if (style) { e.style.cssText = style; }
    if (typeof content == "string") { e.appendChild(document.createTextNode(content)); }
    else if (content) { for (var i = 0; i < content.length; ++i) { e.appendChild(content[i]); } }
    return e;
}


function mark_css(cm, line_index, css_class){
    line_content = cm.getLine(line_index);
    cm.markText({line:line_index,ch:0}, {line:line_index,ch:line_content.length+1},
            {className:css_class, inclusiveLeft: true, inclusiveRight: false});
}

function mark_edit_span(cm, line_index, css_class, from, to, newtxt, sug_id){
    // line_content = cm.getLine(line_index);
    mark = cm.markText({line:line_index,ch:from}, {line:line_index,ch:to},
            {attributes: {"type":"unsup_span", "newtxt":newtxt, "sug_id":sug_id} ,className:css_class, inclusiveLeft: false, inclusiveRight: false});
    return mark;
}


function clear_all_marks_and_bookmarks(cm, line_index){
    all_marks=cm.getAllMarks();

    for (let i = 0; i < all_marks.length; i++) {
        this_mark = all_marks[i];

        if (this_mark.hasOwnProperty("attributes") && this_mark.attributes!==null) {
            if (this_mark.attributes.hasOwnProperty("ref_ids")) {
                // this is the ref_ids code tag which should not be removed
                continue;
            }
        }

        this_pos = this_mark.find();

        if(this_mark.type==="bookmark"){
            this_line = this_pos.line;
        } else {
            this_line = this_pos.from.line;
        }

        if (this_line==line_index)
            this_mark.clear();
    }

}


function destroy_edit_sug(sug_id){
    all_marks=cm.getAllMarks();

    for (let i = 0; i < all_marks.length; i++) {
        this_mark = all_marks[i];

        if(this_mark.type!=="bookmark")
            continue;

        this_dom = this_mark.widgetNode.firstChild;

        if ($(this_dom).attr("sug_id")===sug_id){
            this_mark.clear();
        }

    }
}

function mark_attributes(cm, line_index, attributes_obj){
    line_content = cm.getLine(line_index);
    cm.markText({line:line_index,ch:0}, {line:line_index,ch:line_content.length+1},
            {attributes:attributes_obj, inclusiveLeft: false, inclusiveRight: false});
}

function append_line(cm, txt, css_class, attributes_obj, withnewline){
    var doc = cm.getDoc();
    last_line_index = doc.lastLine();
    last_line_obj = doc.getLine(last_line_index);
    pos = { // create a new object to avoid mutation of the original selection
        line: last_line_index,
        ch: last_line_obj.length // set the character position to the end of the line
    }
    if (withnewline)
        txt = txt+"\n"
    doc.replaceRange(txt, pos, pos, "initload"); // adds a new line
    if (css_class!==null)
        mark_css(cm, last_line_index, css_class);
    if (attributes_obj!==null)
        mark_attributes(cm, last_line_index, attributes_obj);
}

var load_datapoint = function($scope, datapoint){

    input_lines = datapoint["input_lines"];
    output_lines = datapoint["output_lines"];
    $scope.refs = {};

    $("#question_txt").val(datapoint["question"]);

    $scope.$apply();

    $scope.src_cm.getDoc().setValue("");   // clear the text
    for(var line_index=0; line_index<input_lines.length; line_index++){
        line = input_lines[line_index];
        withnewline = line_index!=input_lines.length-1;
        append_line($scope.src_cm, line, null, null, withnewline);
    }


    $scope.cm.getDoc().setValue("");   // clear the text
    for (let line_no = 0; line_no < output_lines.length; line_no++) {
        oneline = output_lines[line_no];
        append_line($scope.cm, oneline, null, null, true);
    }

};

function make_toast(header, body){
    $("#toast_header").html(header);
    $("#toast_text").html(body);
    $(".toast").toast("show");
}


angular.module('newapp', ['ngAnimate', 'ngSanitize', 'ui.bootstrap']);
angular.module('newapp').controller('FactChecker', function ($scope, $http) {

    $scope.init_editor = function () {

        var cm = CodeMirror.fromTextArea(document.getElementById("notearea"), {
            lineNumbers: true,
            lineWrapping: true,
            mode: "text/plain",
            styleActiveLine: true,
            gutters: ["CodeMirror-linenumbers", "status"]
        });
        cm.setSize('100%','100%');
        $scope.cm = cm;
        window.cm = cm;

        cm_div = cm.getWrapperElement();
        cm_div.setAttribute("id", "cm_div");

        var src_cm = CodeMirror.fromTextArea(document.getElementById("sourcearea"), {
            lineNumbers: true,
            lineWrapping: true,
            mode: "text/plain",
            styleActiveLine: false,
            readOnly: true
        });
        src_cm.setSize('100%','100%');
        $scope.src_cm = src_cm;
        window.src_cm = src_cm;

        src_div = src_cm.getWrapperElement();
        src_div.setAttribute("id", "source_cm_div");
        src_scroll_div = $(src_div).find(".CodeMirror-vscrollbar")[0];
        src_scroll_div.setAttribute("id", "src_cm_scroll_div");
        $(src_scroll_div).addClass("prettyscroll");

        summ_div = cm.getWrapperElement();
        $(summ_div).find(".CodeMirror-vscrollbar").addClass("prettyscroll");



        $scope.annotate_new_suggestion= function (cm, line_pos, ch_pos , txt, sug_id){
                var container = document.createElement('div');
                container.style.display = 'inline-block';
                container.style.verticalAlign = 'text-bottom';
                container.style.width="1px";
                container.style.height="3em";
                container.style.background="lightgreen";
                container.setAttribute("sug_id", sug_id);

                cm.setBookmark({line:line_pos, ch:ch_pos}, {widget:container, insertLeft:true, handleMouseEvents:true});

                var text = document.createElement('div');
                text.style.whiteSpace = "nowrap";
                text.style.position = "absolute";
                text.style.float = "left";
                text.style.fontStyle = "italic";

                text.innerHTML=txt;
                text.style.background="lightgreen";
                container.appendChild(text);

                sugdiv = text;
                delspandivs = $(".err_span").filter(function(){
                                       return $(this).attr('sug_id') == sug_id
                                    });

                lmost = 999999
                rmost = -999999

                for (let i = 0; i < delspandivs.length; i++) {
                    elem = delspandivs[i];
                    this_rect = elem.getBoundingClientRect();
                    lmost = Math.min(lmost, this_rect.left);
                    rmost = Math.max(rmost, this_rect.right);
                }
                allowed_width = rmost-lmost;

                pos2 = sugdiv.getBoundingClientRect();
                curwidth = pos2.right-pos2.left;


                if(curwidth>allowed_width){
                    proportion = allowed_width/curwidth;
                    numcharsallowed = Math.floor(txt.length*proportion);
                    text.innerHTML = txt.substr(0,numcharsallowed)+"..";
                }

                $(text).tooltip({
                            "title":txt,
                            "placement": "top"
                    });

        };




        $scope.commit_sug = function (sug_id) {

            all_marks = $scope.cm.getAllMarks();

            for (let i = 0; i < all_marks.length; i++) {
                onemark = all_marks[i];
                if (onemark.hasOwnProperty("attributes") &&
                    onemark["attributes"].hasOwnProperty("type") &&
                    onemark["attributes"]["type"]==="unsup_span" &&
                    onemark["attributes"]["sug_id"]===sug_id) {
                    markpos = onemark.find();
                    newtxt = onemark["attributes"]["newtxt"];
                    cm.replaceRange(newtxt, markpos.from, markpos.to, "factcheck");
                }
            }

        };


        $scope.annotate_edit_button = function (cm, line_pos, ch_pos , sug_id, type){
                var container = document.createElement('div');
                container.style.display = 'inline-block';
                container.style.verticalAlign = 'text-bottom';
                container.style.width="1em";
                container.style.height="1.5em";
                container.setAttribute("sug_id", sug_id);


                cm.setBookmark({line:line_pos, ch:ch_pos}, {widget:container, insertLeft:false, handleMouseEvents:true});

                var text = document.createElement('i');

                if(type==="delete")
                    text.className = "fa fa-times"; //"fa fa-minus-circle";
                else if(type==="replace")
                    text.className = "fa fa-redo";

                text.style.whiteSpace = "nowrap";
                text.style.position = "absolute";
                text.style.float = "left";
                text.style.fontSize = "1em";
                text.style.cursor = "pointer";

                text.style.color="#99484d";
                container.appendChild(text);

                $(text).on("click", function (){
                    console.log("ACCEPT SUGGESTION CLICKED");
                    $scope.commit_sug(sug_id);
                });

        };


        function cursorActivityHandler(cm){


            line_no = cm.getCursor().line;
            if($scope.active_editor_line===line_no)
                return;
            $scope.active_editor_line = line_no;
            line_content = cm.getLine(line_no);

           found_marks = cm.findMarksAt({line:line_no, ch:0});
           for (var i=0; i<found_marks.length; i++) {
                mark = found_marks[i];
                if (mark.hasOwnProperty("attributes") && mark.attributes!==null) {
                    if (mark.attributes.hasOwnProperty("ref_ids")) {
                        if (line_content === "") {
                            $scope.active_editor_line_refcode = null;
                            $scope.cm_activeline_top = null;
                            $scope.mark_evidence_highlights([]);
                            $scope.$apply();
                            return;
                        } else {
                            $scope.active_editor_line_refcode = mark.attributes.ref_ids;
                            target_line_coords = cm.cursorCoords({line:cm.getCursor().line,ch:0}, "page");
                            $scope.cm_activeline_top = target_line_coords.top;

                            if(mark.attributes.ref_ids in $scope.refs)
                                $scope.mark_evidence_highlights($scope.refs[mark.attributes.ref_ids]);

                            $scope.$apply();
                            return;
                        }
                    }
                }
            }
            // if line has no marks or no refs, make arrows vanish
            $scope.active_editor_line_refcode = null;
            $scope.cm_activeline_top = null;
            $scope.mark_evidence_highlights([]);
            $scope.$apply();
            return;
        }


        $scope.get_formatted_src_text = function (){
            formatted_list = [];
            num_lines = $scope.src_cm.lineCount();
            for (let cur_line_index = 0; cur_line_index < num_lines; cur_line_index++) {
                txt = $scope.src_cm.getLine(cur_line_index);
                formatted_list.push({
                    "txt": txt,
                    "section_name": "notneeded",
                    "section_index": 0
                });
            }
            return formatted_list;
        };


        $scope.tokenize_source = function (){
            const initval = $scope.src_cm.getValue();

            $.ajax({
                type: "POST",
                url: "./sent_tokenize",
                data: {
                    "doc": initval
                },
                success: function (data) {
                    newtxt = data["prediction"];
                    $scope.src_cm.setValue(newtxt);
                }
            });

        };

        $scope.qa_generic = function(){
            this_obj = {
                "article_lines" : $scope.get_formatted_src_text(),
                "question": $("#question_txt").val()
            };

            $("#qa_button").prop("disabled",true)

            $scope.cm.setOption("readonly","nocursor");

            el = document.createElement('div');
            el.className="loading-overlay";
            el2 = makeMarker("4em");
            el2.style.margin = "auto";
            el.appendChild(el2);
            $scope.cm.getWrapperElement().appendChild(el);

            $scope.clear_all_ev_sugs();


            $.ajax({
                type: "POST",
                url: "./get_qa",
                data: {
                    "bundle": JSON.stringify(this_obj)
                },
                success: function (data) {

                    $(".loading-overlay").remove();
                    $("#qa_button").prop("disabled",false);

                    console.log(data);

                    if (!data["success"]){
                        make_toast("Error", data["reason"]);
                        return;
                    }

                    $scope.cm.setValue("");
                    sents = data["prediction"];
                    for (let line_no = 0; line_no < sents.length; line_no++) {
                        oneline = sents[line_no];
                        append_line($scope.cm, oneline, null, null, true);
                    }



                },
              error: function(xhr,status,error) {
                    $(".loading-overlay").remove();
                    $("#qa_button").prop("disabled",false);

                    make_toast("Error", "Unknown error occurred");
              }

            });

        }


        $scope.clear_all_ev_sugs = function(){

            num_lines = $scope.cm.lineCount();
            for (let i = 0; i < num_lines; i++) {
                clear_all_marks_and_bookmarks($scope.cm, i);
            }

            for (const line_code in $scope.refs) {
                $scope.refs[line_code] = [];
            }
        }


        $scope.toggle_srcedit = function(){
            is_locked = $scope.src_cm.getOption("readOnly");
            if (is_locked){
                $scope.src_unlocked=true;
                $("#srcedit_icon").removeClass("fa-lock").addClass("fa-unlock");
                $scope.src_cm.setOption("readOnly", false);
                $scope.txt_at_unlock = $scope.src_cm.getValue();
            } else {

                console.log("CHECKING FOR LENGTH...... REQ SENT");
                // check if the source length is okay
                $.ajax({
                    type: "POST",
                    url: "./check_length",
                    data: {
                        "doc": $scope.src_cm.getValue()
                    },
                    success: function (data) {
                        curr_len = data["curr_len"]
                        allowed_len = data["allowed_len"]
                        okay = data["okay"]

                        if (!okay) {
                            console.log("length over limit", curr_len, allowed_len);
                            make_toast("Error", "Curent length of input is "+
                                (curr_len-allowed_len) +
                                " words over the allowed limit" +
                                ". Please decrease length of input.");
                        }
                        else{

                            $scope.src_unlocked=false;
                            $("#srcedit_icon").removeClass("fa-unlock").addClass("fa-lock");
                            $scope.src_cm.setOption("readOnly", true);

                            if($scope.txt_at_unlock==$scope.src_cm.getValue()){ // no change made
                                $scope.$apply();
                                return;
                            }

                            $scope.clear_all_ev_sugs();

                            if ($scope.autocheck){
                                num_lines = $scope.cm.lineCount();
                                for (let cur_line_index = 0; cur_line_index < num_lines; cur_line_index++) {
                                    const txt = $scope.cm.getLine(cur_line_index);
                                    const line_code = $scope.get_code_for_line_index(cm, cur_line_index);
                                    const curtime = Date.now();

                                    if (txt.trim().length===0||line_code===null){
                                        continue;
                                    } else{
                                        $scope.facteval_lastts[line_code] = curtime;
                                        queueUpdate(txt, line_code, curtime);
                                    }
                                }
                            }

                            $scope.$apply();
                        }

                    }
                });

            }
        };


        $scope.save_state = function (){

            source_lines = [];
            num_lines = $scope.src_cm.lineCount();
            for (let cur_line_index = 0; cur_line_index < num_lines; cur_line_index++) {
                txt = $scope.src_cm.getLine(cur_line_index);
                source_lines.push(txt);
            }

            target_lines = [];
            line_codes = [];

            num_lines = $scope.cm.lineCount();

            for (let cur_line_index = 0; cur_line_index < num_lines; cur_line_index++) {

                txt = $scope.cm.getLine(cur_line_index);
                target_lines.push(txt);

                line_code = $scope.get_code_for_line_index($scope.cm, cur_line_index);
                line_codes.push(line_code);

            }

            // remove all trailing empty lines
            for (let cur_line_index = num_lines-1; cur_line_index >= 0; cur_line_index--) {
                if (target_lines[cur_line_index].length==0){
                    target_lines.pop();
                    line_codes.pop();
                }else {
                    break;
                }
            }


            return {
                "input_lines": source_lines,
                "output_lines": target_lines,
                "line_codes": line_codes,
            }

        }


        $scope.save_example_submit = function (){
            saving_id_val = $scope.saving_id_val;
            saving_notes_val = $scope.saving_notes_val;
            question_val = $("#question_txt").val();

            var save_obj = $scope.save_state();
            save_obj["id"] = saving_id_val;
            save_obj["notes"] = saving_notes_val;
            save_obj["question"] = question_val;

            $.ajax({
                type: "POST",
                url: "./save_example",
                data: {
                    "bundle": JSON.stringify(save_obj)
                },
                success: function (data) {
                    console.log(data);
                    $("#save_modal").modal("hide");
                    if(data.success==true){
                        make_toast("Success", "Saved example successfully");
                        $("#saving_id").val("");
                        $("#saving_notes").val("");
                    }
                    else {
                        make_toast("Failure", data.reason);
                    }
                },
              error: function(xhr,status,error) {
                    $("#save_modal").modal("hide");
                    make_toast("Error", "Unknown error occurred");
              }

            });
        }


        $scope.is_visible_evidence = function(book){

            var rect = src_cm.getWrapperElement().getBoundingClientRect();
            var topVisibleLine = src_cm.lineAtHeight(rect.top, "window");
            var bottomVisibleLine = src_cm.lineAtHeight(rect.bottom, "window");
            if (book<topVisibleLine || book >bottomVisibleLine)
                return false;

            var rect = cm.getWrapperElement().getBoundingClientRect();
            var topVisibleLine = cm.lineAtHeight(rect.top, "window");
            var bottomVisibleLine = cm.lineAtHeight(rect.bottom, "window");
            var active_summ_line_idx = cm.getCursor().line;
            if (active_summ_line_idx<topVisibleLine || active_summ_line_idx >bottomVisibleLine)
                return false;

            return true;
        }

        $scope.is_visible_evidence_src = function(book){

            var rect = src_cm.getWrapperElement().getBoundingClientRect();
            var topVisibleLine = src_cm.lineAtHeight(rect.top, "window");
            var bottomVisibleLine = src_cm.lineAtHeight(rect.bottom, "window");
            if (book<topVisibleLine || book >bottomVisibleLine)
                return false;

            return true;
        }

        $scope.is_visible_evidence_summ = function(book){

            var rect = cm.getWrapperElement().getBoundingClientRect();
            var topVisibleLine = cm.lineAtHeight(rect.top, "window");
            var bottomVisibleLine = cm.lineAtHeight(rect.bottom, "window");
            var active_summ_line_idx = cm.getCursor().line;
            if (active_summ_line_idx<topVisibleLine || active_summ_line_idx >bottomVisibleLine)
                return false;

            return true;
        }


        $scope.get_code_for_line_index = function (cm, line_index){
           found_marks = cm.findMarksAt({line:line_index, ch:0});
           for (var i=0; i<found_marks.length; i++) {
               mark = found_marks[i];
               if (mark.hasOwnProperty("attributes") && mark.attributes !== null) {
                   if (mark.attributes.hasOwnProperty("ref_ids")) {
                       return mark.attributes.ref_ids;
                   }
               }
           }
           return null;
        }


        $scope.get_line_index_for_code = function (cm, code) {
            for (let i = 0; i < cm.lineCount(); i++) {
                thisline_code = $scope.get_code_for_line_index(cm, i);
                if (thisline_code===code){
                    return i;
                }
            }
            return null;
        }


        $scope.search_code_in_line_index = function (cm, line_index) {
            found_marks = cm.findMarks({line: line_index, ch: 0}, {line: line_index, ch: 999});

            selected_marks = [];

            for (var i = 0; i < found_marks.length; i++) {
                mark = found_marks[i];
                if (mark.hasOwnProperty("attributes") && mark.attributes !== null) {
                    if (mark.attributes.hasOwnProperty("ref_ids")) {
                        this_refids = mark.attributes.ref_ids;
                        this_pos = mark.find();
                        selected_marks.push([mark, this_pos, this_refids]);
                    }
                }
            }

            if (selected_marks.length == 0)
                return null;

            // take the leftmost found marker, in case there are multiple
            selected_marks.sort(function (x, y) {
                return x[1].ch - y[1].ch
            });
            return selected_marks[0][2];

        }

        $scope.clear_code_on_line = function(cm, line_index){
           found_marks = cm.findMarks({line:line_index, ch:0}, {line:line_index, ch:999});

           // this is needed because if there are pending checks on that line index, they won't
            // be able to remove the spinner icon when they return
           cm.setGutterMarker(line_index, "status", makeMarkerRun());

           for (var i=0; i<found_marks.length; i++) {
               mark = found_marks[i];
               if (mark.hasOwnProperty("attributes") && mark.attributes !== null) {
                   if (mark.attributes.hasOwnProperty("ref_ids")) {
                       this_refids = mark.attributes.ref_ids;
                       this_pos = mark.find();
                       start_pos = this_pos.from;
                       end_pos = this_pos.to;
                       // this special case is to handle situations where one line is broken into 2
                       if (start_pos.line<line_index){
                           prevline_length = cm.getLine(line_index-1).length;
                           cm.markText({line:start_pos.line,ch:start_pos.ch}, {line:line_index-1,ch:prevline_length},
                                {attributes:{"ref_ids": this_refids}, inclusiveLeft: false, inclusiveRight: false});
                       }

                       mark.clear();
                   }
               }
           }
        };


        $scope.mark_evidence_highlights = function (list_of_indices){
            N = $scope.src_cm.lineCount();
            for (let i = 0; i < N; i++) {
                if(list_of_indices.includes(i)){
                    $scope.src_cm.addLineClass(i, "wrap", "evidence");
                }
                else {
                    $scope.src_cm.removeLineClass(i, "wrap", "evidence");
                }
            }
        }

        function fireUpdate(cur_line_index){
            const txt = cm.getLine(cur_line_index);

            if (txt.trim().length==0)
                return;

            const line_code = $scope.get_code_for_line_index($scope.cm, cur_line_index);
            const curtime = Date.now();

            $scope.facteval_lastts[line_code] = curtime;

            if (!(line_code in $scope.facteval_promisechain)){
                $scope.facteval_promisechain[line_code] = new Promise((resolve, reject) => {
                        resolve(true);
                    });
            }


            queueUpdate(txt, line_code, curtime);

        }

        $scope.checkall = function(){
            N = $scope.cm.lineCount();
            for (let i = 0; i < N; i++) {
                if($scope.cm.getLine(i).trim().length>0)
                    fireUpdate(i);
            }
        }

        function makeMarkerRun(status_gutter_width){
              var marker = document.createElement("div");

              var icon = document.createElement('i');
              icon.className = 'fa fa-refresh play-button';
              marker.appendChild(icon);


              $(marker).on("click", function (ev){
                  line_index_str = $(this).parent().parent().find(".CodeMirror-linenumber").html();
                  line_index = parseInt(line_index_str)-1;
                  fireUpdate(line_index);
              });

              return marker;
        }

        // from :https://codemirror.net/5/demo/marker.html
        function makeMarker(status_gutter_width) {

            // from here: https://getbootstrap.com/docs/4.2/components/spinners/

              var spinner = document.createElement('div');
              spinner.className = 'spinner-border';
              spinner.setAttribute('role', 'status');
              spinner.style.width=status_gutter_width;
              spinner.style.height=status_gutter_width;

              // Create the text element
              var text = document.createElement('span');
              text.className = 'sr-only';
              text.textContent = 'Loading...';

              // Append the text element to the spinner element
              spinner.appendChild(text);

              return spinner;

            }


        function queueUpdate(txt, line_code, curtime) {

                const old_source_txt = $scope.src_cm.getValue();

                $scope.facteval_promisechain[line_code] = $scope.facteval_promisechain[line_code].then(function(x){

                    return new Promise(async (resolve,reject)=> {
                        if($scope.facteval_lastts[line_code]>curtime){
                            console.log("future calls pending, so skipping...===");
                            resolve(false);
                            return;
                            }

                        target_line_index = $scope.get_line_index_for_code(cm, line_code);

                        status_gutter_width = $($(cm.getGutterElement()).find(".status")).css("width");
                        cm.setGutterMarker(target_line_index, "status", makeMarker(status_gutter_width));


                        await $scope.sema.acquire()
                        console.log("acquired lock");

                        if($scope.facteval_lastts[line_code]>curtime){
                            console.log("future calls pending, so skipping...===");
                            resolve(0);
                            $scope.sema.release();
                            return;
                            }

                        target_line_index = $scope.get_line_index_for_code(cm, line_code);
                        prev_lines = [];
                        for (let i = 0; i < target_line_index; i++) {
                            prev_lines.push(cm.getLine(i));
                        }

                        if($scope.src_cm.getValue()!==old_source_txt){

                            console.log("article changed, so skipping...===");

                            target_line_index = $scope.get_line_index_for_code(cm, line_code);

                            if (target_line_index==null){
                                console.log("WARNING: LINE CODE", line_code," NO LONGER EXISTS...");
                            } else {
                                console.log("SUCCESS LINE CODE ", line_code, "MAPS TO", target_line_index);
                                cm.setGutterMarker(target_line_index, "status", makeMarkerRun());
                            }
                            resolve(0);
                            $scope.sema.release();
                            return;

                        }

                    console.log("GETTING EVIDENCE AND FIX ...");


                    $.ajax({
                        url: './get_ev_with_fixfactuality',
                        type: "POST",
                        data: {
                            "bundle": JSON.stringify({
                                    "article_lines": $scope.get_formatted_src_text(),
                                    "prev_lines": prev_lines,
                                    "summary_line": txt
                                      })
                              },
                        success: function (resp){
                                    console.log(resp);
                                    console.log("executing...===");

                                    target_line_index = $scope.get_line_index_for_code(cm, line_code);
                                    console.log("SUCCESS LINE CODE ", line_code, "MAPS TO", target_line_index);

                                    if ($scope.facteval_lastts[line_code]>curtime || $scope.src_cm.getValue()!==old_source_txt){
                                        console.log("NEXT ONE IS PENDING, OR THE SOURCE CHANGED, SO WONT UPDATE");
                                        if (target_line_index!=null)
                                            cm.setGutterMarker(target_line_index, "status", makeMarkerRun());
                                        $scope.sema.release();
                                        resolve(1);
                                        return;
                                    }

                                    console.log("SETTING LABELS FOR ",line_code, "EVIDENCE = ", resp["evidence_labels"]);
                                    $scope.refs[line_code] = resp["evidence_labels"];

                                    if(line_code==$scope.active_editor_line_refcode){
                                        $scope.mark_evidence_highlights(resp["evidence_labels"]);
                                    }

                                    todelete_spans = resp["todelete_spans"];
                                    replacement_strings = resp["replacement_strings"];


                                    if (target_line_index==null){
                                        console.log("WARNING: LINE CODE", line_code," NO LONGER EXISTS. ABORTING...");
                                        resolve(0);
                                        $scope.sema.release();
                                        return;
                                    }

                                    clear_all_marks_and_bookmarks(cm, target_line_index);

                                    for (let i = 0; i < todelete_spans.length; i++) {
                                        one_span = todelete_spans[i];
                                        repl_str = replacement_strings[i];
                                        ch_startidx = one_span[0];
                                        ch_endidx = one_span[1];

                                        css_class_tomark = "unsup_span";
                                        if(repl_str.length>0)
                                            css_class_tomark = "err_span";

                                        const sug_id = Math.random().toString();

                                        const sug_marker = mark_edit_span(cm,
                                                       target_line_index,
                                                       css_class_tomark,
                                                       ch_startidx,
                                                       ch_endidx,
                                                       repl_str,
                                                       sug_id);

                                        sug_marker.on("hide", function (){
                                            sug_marker.clear();
                                            destroy_edit_sug(sug_id);
                                        });

                                        if (repl_str.length==0)
                                            $scope.annotate_edit_button(cm, target_line_index, ch_endidx, sug_id, "delete");
                                        else
                                            $scope.annotate_edit_button(cm, target_line_index, ch_endidx, sug_id, "replace");


                                        if(repl_str.length>0){
                                            $scope.annotate_new_suggestion(cm, target_line_index, ch_startidx, repl_str, sug_id);
                                        }

                                    }

                                    cm.setGutterMarker(target_line_index, "status", makeMarkerRun());
                                    $scope.$apply();
                                    resolve(1);
                                    $scope.sema.release();
                            },
                      error: function(xhr,status,error) {

                            if ($scope.facteval_lastts[line_code]>curtime){
                                resolve(0);
                                $scope.sema.release();
                                return;
                            }
                            target_line_index = $scope.get_line_index_for_code(cm, line_code);

                            if (target_line_index==null){
                                console.log("WARNING: LINE CODE", line_code," NO LONGER EXISTS. ABORTING...");
                                resolve(0);
                            }

                            console.log("SUCCESS LINE CODE ", line_code, "MAPS TO", target_line_index);
                            cm.setGutterMarker(target_line_index, "status", makeMarkerRun());
                            resolve(0);
                            $scope.sema.release();
                              }

                       });


                    });

                });
        }


        function get_gutter_marker(line_index) {
            // i have no idea why this is not already implemented in codemirror
            els = $(window.cm.getWrapperElement()).find(".CodeMirror-code").find(".CodeMirror-line")[line_index];
            els = $(els).parent().find(".CodeMirror-gutter-elt").not(".CodeMirror-linenumber");
            if (els.length==0){
                return null;
            }

            el = els[0].children[0];
            return el;
        }


        function changeHandler(cm, changeObj){
            console.log(changeObj);

            if((changeObj.origin==="+input"||
                changeObj.origin==="+delete"||
                changeObj.origin==="paste"||
                changeObj.origin==="cut"||
                changeObj.origin==="complete"||
                changeObj.origin==="suggestion_commit_origin"||
                changeObj.origin==="initload"||
                changeObj.origin==="undo"||
                changeObj.origin==="redo"||
                changeObj.origin==="factcheck")){

                start_line_idx = changeObj.from.line;
                num_new_lines = changeObj.text.length;

                code_used_sofar = [];


                for (let z = 0; z < num_new_lines; z++) {

                        cur_line_index = start_line_idx + z;

                        const txt = cm.getLine(cur_line_index);

                        if (txt.trim().length==0){
                            console.log("EMPTY LINE: CLEARING ALL MARKS ON LINE INDEX ", cur_line_index);
                            clear_all_marks_and_bookmarks(cm, cur_line_index);
                            cm.setGutterMarker(cur_line_index, "status", null);
                            continue;
                        }
                        else {
                            gutter_el = get_gutter_marker(cur_line_index);
                            if (gutter_el==null || !$scope.autocheck){
                                cm.setGutterMarker(cur_line_index, "status", makeMarkerRun());
                            }
                        }

                        tentative_line_code = $scope.get_code_for_line_index(cm, cur_line_index);

                        if (code_used_sofar.includes(tentative_line_code)){  // the condition is needed when one line is broken into 2
                            $scope.clear_code_on_line(cm, cur_line_index);
                            tentative_line_code = Math.random().toString();
                            $scope.active_editor_line_refcode = tentative_line_code;
                            target_line_coords = cm.cursorCoords({line:cm.getCursor().line,ch:0}, "page");
                            $scope.cm_activeline_top = target_line_coords.top;
                            mark_attributes(cm, cur_line_index, {"ref_ids": tentative_line_code});
                        }


                        if (tentative_line_code==null){  // note this also happens when text is added at the beginning of the sentence
                            maybe_code_ahead = $scope.search_code_in_line_index(cm, cur_line_index);
                            $scope.clear_code_on_line(cm, cur_line_index);
                            if (maybe_code_ahead===null)
                                tentative_line_code = Math.random().toString();
                            else //there was some code found not at ch:0 but somewhere ahead. so should just use that
                                tentative_line_code = maybe_code_ahead;
                            $scope.active_editor_line_refcode = tentative_line_code;
                            target_line_coords = cm.cursorCoords({line:cm.getCursor().line,ch:0}, "page");
                            $scope.cm_activeline_top = target_line_coords.top;
                            mark_attributes(cm, cur_line_index, {"ref_ids": tentative_line_code});
                        }

                        code_used_sofar.push(tentative_line_code);

                        if (changeObj.origin==="factcheck") // the lines ahead queue updates. we dont need that if user just accepting a suggestion from backend
                            continue;

                        const line_code = tentative_line_code;

                        const curtime = Date.now();
                        $scope.facteval_lastts[line_code] = curtime;

                        if (!(line_code in $scope.facteval_promisechain)){
                            $scope.facteval_promisechain[line_code] = new Promise((resolve, reject) => {
                                    resolve(true);
                                });
                        }

                        if($scope.autocheck && txt.trim().length>0){
                            queueUpdate(txt, line_code, curtime);
                        }

                }

            }
        }


        function scrollHandler(cm){
            target_line_coords = cm.cursorCoords({line:cm.getCursor().line,ch:0}, "page");
            $scope.cm_activeline_top = target_line_coords.top;
            $scope.refs = JSON.parse(JSON.stringify($scope.refs)); //should trigger redrawing coz you make a new object
            $scope.$apply();
        }

        function beforeChangeHandler(cm, changeObj) {
            if (changeObj.origin==="suggestion_commit_origin"||changeObj.origin==="initload"||changeObj.origin==="setValue")
                return;

            if (changeObj.origin==="undo"||changeObj.origin==="redo"){
                changeObj.cancel();
                return;
            }

            if ($scope.src_unlocked){
                make_toast("Error", "You cannot edit the summary while editing the source");
                changeObj.cancel();
            }
        }


        function srcScrollHandler(cm){
            $scope.$apply();
        }


        function commitFactChange(cm, pos){

            found_marks = cm.findMarksAt({line:pos.line, ch:pos.ch});

            for (let j = 0; j < found_marks.length; j++) {
                onemark = found_marks[j];
                if (onemark.hasOwnProperty("attributes") &&
                    onemark["attributes"].hasOwnProperty("type") &&
                    onemark["attributes"]["type"]==="unsup_span" ){
                        markpos = onemark.find();
                        newtxt = onemark["attributes"]["newtxt"];

                        cm.replaceRange(newtxt, markpos.from, markpos.to, "factcheck");

                }
            }
        }


        src_cm.on("scroll", srcScrollHandler);
        cm.on("scroll", scrollHandler);
        cm.on("cursorActivity", cursorActivityHandler);
        cm.on("change", changeHandler);

        cm.setOption("extraKeys", {
          Tab: function(cm) {
            pos = cm.getCursor();
            commitFactChange(cm, pos);
          }
        });

        cm.on("beforeChange", beforeChangeHandler);

    };

    $scope.conv_scroll_to_pos = function (target_pos){
        cur_scroll_pos = $("#src_cm_scroll_div").scrollTop();
        if (cur_scroll_pos!==$scope.revert_position) {
            console.log("Setting aim for ", cur_scroll_pos);
            $scope.revert_position = cur_scroll_pos;
        }
        $("#src_cm_scroll_div").animate({scrollTop: target_pos}, 500, "swing");  // css, speed, easing(linear or swing)
        $scope.tease_out_book();
    }


    $scope.create_bookmark_obj = function(line_index){
        line_index = parseInt(line_index);
        line_coords = src_cm.cursorCoords({line:line_index,ch:0}, "local");
        target_scroll_pos = line_coords.top;
        scroll_pos = $("#src_cm_scroll_div").scrollTop();
        scroll_height = $("#src_cm_scroll_div")[0].scrollHeight;
        dom_height = $("#src_cm_scroll_div").height();
        offset = (target_scroll_pos / scroll_height) * dom_height;

        src_rect = $("#source_cm_div")[0].getBoundingClientRect();

        src_rect_rightedge = src_rect.x + src_rect.width + window.pageXOffset;
        src_rect_toppos = offset + src_rect.y + window.pageYOffset;

        src_textrect = $("#source_cm_div").find(".CodeMirror-lines")[0].getBoundingClientRect();
        src_textrect_rightedge = src_textrect.x + src_textrect.width + window.pageXOffset;

        onscreen_pixelpos = window.pageYOffset + src_rect.y + (target_scroll_pos-scroll_pos);


        onscreen_pixelpos = Math.max(onscreen_pixelpos, window.pageYOffset + src_rect.y - 1 ); //clipping so that it doesnt go too negative above page
        onscreen_pixelpos = Math.min(onscreen_pixelpos, window.pageYOffset + src_rect.y + src_rect.height + 1 ); //clipping so that it doesnt go too postive below page

        targ_rect = $("#cm_div")[0].getBoundingClientRect();
        targ_rect_leftedge = targ_rect.x + window.pageXOffset;
        targ_rect_toppos = $scope.cm_activeline_top;

        targ_rect_pixelpos = Math.max(targ_rect_toppos, window.pageYOffset + targ_rect.y -1 );
        targ_rect_pixelpos = Math.min(targ_rect_pixelpos, window.pageYOffset + targ_rect.y + targ_rect.height +1 );


        return {"title": "todo",
                "ypos": offset.toString()+"px",
                "scroll_target":target_scroll_pos,
                "line_index": line_index,
                "left": src_rect_rightedge,
                "width": targ_rect_leftedge - src_rect_rightedge,
                "top": Math.min(targ_rect_pixelpos, onscreen_pixelpos),
                "height": Math.abs(targ_rect_pixelpos-onscreen_pixelpos),
                "beg_top": onscreen_pixelpos,
                "end_top": targ_rect_toppos,
                "srcollbar_beg_top": src_rect_toppos,
                "scrollbar_end_top": targ_rect_pixelpos,
                };
    }

    $scope.link_thickness = 3;


    $scope.handle_click_on_closeup = function (){
        if($scope.refs!==undefined && $scope.refs.length>0){
            $scope.scroll_to_utt_index($scope.refs[0]);
        }
        else{
            $scope.scroll_to_utt_index($scope.relevant_sugs[0]);
            $scope.relevant_sugs = [];
        }
    };

    $scope.tease_in_book = function(bkmrk_idx){
        console.log("ENTERING"+bkmrk_idx);
        target_line = $scope.refs[$scope.active_editor_line_refcode][bkmrk_idx];

        // if the evidence is already visible then dont show tooltip else it's confusing
        if ($scope.is_visible_evidence(target_line))
            return;

        bookmark_obj = $scope.create_bookmark_obj(target_line);

        source_editor_dom = $("#source_cm_div")[0].getBoundingClientRect();
        source_width = source_editor_dom.right - source_editor_dom.left;

        MINOR_LEFT_SHIFT = 32;
        BOX_WIDTH = source_width*0.6;

        top_pos = bookmark_obj["srcollbar_beg_top"];

        text = src_cm.getLine(target_line);
        $(".reference_closeup")[0].innerHTML = "<span>"+text+"</span>";

        $(".reference_closeup").css("top", top_pos);
        $(".reference_closeup").css("left", source_editor_dom.right-BOX_WIDTH-MINOR_LEFT_SHIFT);
        $(".reference_closeup").css("width", BOX_WIDTH);

        $(".reference_closeup").css("visibility", "visible");

    }

    $scope.tease_out_book = function(line_index){
        console.log("LEAVING"+line_index);
        $(".reference_closeup").css("visibility", "hidden");
        $(".reference_closeup")[0].innerHTML="";
    }


    $scope.refresh_datapoint = function(job_id) {
        $scope.job_id = job_id;
        $.ajax({
            type: "GET",
            url: "./get_example/"+job_id,
            success: function (data) {
                console.log(data);
                load_datapoint($scope, data);
            }
        });
      };


    $scope.populate_ids = function() {
        $.ajax({
            type: "GET",
            url: "./get_all_ids",
            success: function (data) {
                console.log(data);
                $scope.all_example_ids = data["all_ids"];
                $scope.$apply();
                example_to_show_idx = 0;
                $("#selectex").val(example_to_show_idx);
                $scope.refresh_datapoint(example_to_show_idx);
            }
        });
      };

    $scope.populate_ids();

    $scope.show_config = function (){
        $.ajax({
            type: "GET",
            url: "./get_config",
            success: function (data) {
                console.log(data);
                $scope.sema = new Semaphore(data.factcheck_model.num_procs);
                $scope.backend_config = data;
                $scope.$apply();
                $("#config_modal").modal("show");
            }
        });
    };

    $scope.show_config();


    $("#selectex").on("change",function (){
        job_id = $("#selectex").val();
        $scope.refresh_datapoint(job_id);
    })


    $scope.mylog = console.log;


    $scope.myconsole=console;
    $scope.src_unlocked = false;
    $scope.facteval_lastts = {};
    $scope.facteval_promisechain = {};

    // hack to fix the problem of toast blocking clicks to other ui elements [https://github.com/twbs/bootstrap/issues/28752]
    $(".toast").addClass("hide");

    $(function () {
          $('[data-toggle="tooltip"]').tooltip()
        });



});

