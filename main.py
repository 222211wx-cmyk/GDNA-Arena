app.runfrom flask import Flask, request, jsonify, render_template_string
app = Flask(__name__)

EMPLOYEE_NAME = "Ameeq AI"
OWNER = "GDNA Arena"

def call_ai_engine(user_input): return f"فهمت: {user_input}"

@app.route("/ameeq")
def ameeq_page(): return render_template_string(f"""<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>{EMPLOYEE_NAME}</title><style>body{{background:#0a0a0a;color:#fff;font-family:sans-serif;margin:0;display:flex;flex-direction:column;height:100vh}}header{{background:#111;padding:15px;text-align:center;border-bottom:2px solid gold}}#chat{{flex:1;overflow-y:auto;padding:20px}}.msg{{margin:10px 0;padding:12px 18px;border-radius:12px;max-width:85%}}.user{{background:#222;margin-left:auto}}.ai{{background:#1a1a1a;border:1px solid #333}}footer{{display:flex;padding:15px;background:#111;gap:10px}}#input{{flex:1;padding:14px;border-radius:10px;border:none;background:#222;color:#fff}}#send{{padding:14px 25px;border-radius:10px;border:none;background:gold;color:#000;font-weight:bold;cursor:pointer}}</style></head><body><header><h1>👑 {EMPLOYEE_NAME}</h1></header><div id="chat"><div class="msg ai">السلام. أنا {EMPLOYEE_NAME}.</div></div><footer><input id="input" placeholder="اكتب أمرك هنا..." onkeypress="if(event.key==='Enter') sendCommand()"><button id="send" onclick="sendCommand()">إرسال</button></footer><script>async function sendCommand(){{let input=document.getElementById('input');let cmd=input.value.trim();if(!cmd)return;document.getElementById('chat').innerHTML+=`<div class="msg user">${{cmd}}</div>`;input.value='';let res=await fetch('/ameeq/api',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{command:cmd}})}});let data=await res.json();document.getElementById('chat').innerHTML+=`<div class="msg ai">${{data.response}}</div>`;document.getElementById('chat').scrollTop=document.getElementById('chat').scrollHeight}}</script></body></html>""")

@app.route("/ameeq/api", methods=["POST"])
def ameeq_command():
    user_input = request.json.get("command", "")
    if not user_input: return jsonify({"response": f"👑 {EMPLOYEE_NAME} جاهز"})
    ai_response = call_ai_engine(user_input)
    return jsonify({"response": f"<b>{EMPLOYEE_NAME}</b><hr>{ai_response}"})

if __name__ == '__main__': app.run(host='0.0.0.0', port=8080)
