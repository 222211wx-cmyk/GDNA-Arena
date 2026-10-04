"""Generate read-only audit deliverables from tracked source and Git history.
No application source, credentials, databases, or deployment state are modified.
"""
from pathlib import Path
import base64
import csv
import hashlib
import html
import json
import re
import subprocess
import urllib.request
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True)
def esc(value):
    return html.escape(str(value))
tracked = git("ls-files").splitlines()
head = git("rev-parse", "HEAD").strip()
stamp = datetime.now(timezone.utc).isoformat()
W = "artifacts/gdna-arena/src/"
S = "artifacts/api-server/src/"
M = "artifacts/gdna-arena-mobile/"
pattern = re.compile(r"messag|messenger|call|agora|firebase|signaling|chat|rtc|turn|e2ee|communication|push", re.I)
explicit = {
    W+"App.tsx", W+"main.tsx", W+"service-worker.js", W+"contexts/AuthContext.tsx",
    W+"components/ErrorBoundary.tsx", W+"lib/account-session-events.ts",
    S+"index.ts", S+"app.ts", S+"routes/index.ts", S+"routes/citizen-profiles.ts",
    S+"routes/social-hub.ts", S+"lib/r2-storage.ts", S+"lib/signal-ws-transport.ts",
    "lib/db/src/schema/social.ts", "lib/db/src/schema/users.ts",
    M+"index.js", M+"index.ts", M+"app.config.ts", M+"app.json", M+"eas.json",
    M+"android/app/src/main/AndroidManifest.xml",
}
files = []
for p in tracked:
    if not p.startswith((W, S, M, "lib/db/src/schema/")):
        continue
    if any(s in p for s in ["/build/", "/.gradle/", "/node_modules/", "/.expo/"]):
        continue
    if Path(p).suffix not in {".ts",".tsx",".js",".jsx",".mjs",".cjs",".kt",".java",".xml",".md",".json",".mts"}:
        continue
    if Path(p).name in {"google-services.json","GoogleService-Info.plist"}:
        continue
    if p in explicit or pattern.search(p):
        files.append(p)
files = sorted(set(files))
def label(p):
    return "اختبار" if re.search(r"test|spec", p, re.I) else "توثيق" if p.endswith(".md") else "تنفيذ / إعداد"
with (OUT/"file-inventory.csv").open("w", newline="", encoding="utf-8-sig") as f:
    writer = csv.writer(f)
    writer.writerow(["path","category","lines","sha256"])
    for p in files:
        data=(ROOT/p).read_bytes()
        writer.writerow([p,label(p),len(data.splitlines()),hashlib.sha256(data).hexdigest()])
history = []
for line in git("log","--reverse","--format=%H%x09%aI%x09%s","--",*files).splitlines():
    parts=line.split("\t",2)
    if len(parts)==3: history.append(parts)
with (OUT/"history.csv").open("w", newline="", encoding="utf-8-sig") as f:
    writer=csv.writer(f); writer.writerow(["commit","author_time","subject"]); writer.writerows(history)

route_files = [p for p in files if p.startswith(S+"routes/") and label(p)=="تنفيذ / إعداد"]
routes=[]
for p in route_files:
    text=(ROOT/p).read_text()
    for match in re.finditer(r'router\.(get|post|put|patch|delete|options|head)\(\s*("[^"]+"|\'[^\']+\'|\[[^\]]+\])',text):
        for path in re.findall(r'["\']([^"\']+)["\']',match[2]):
            routes.append([match[1].upper(),"/api"+path,p,text[:match.start()].count("\n")+1])

features = [
("دخول /mes و/messages","مبني؛ الدخول دون جلسة مصوّر الآن","المسار الصحيح الطويل /messages، والقصير /mes alias حديث. الجلسة مشتركة؛ لا يتطلب حساباً منفصلاً.",W+"lib/messages-entry.ts",1,22),
("محادثة فردية","مبنية؛ استُخدمت في اختبار الصورة السابق","POST rooms يتحقق من المستلم، يمنع النفس، ويعيد استخدام غرفة الطرفين بقفل معاملة.",S+"routes/messages.ts",778,821),
("محادثة جماعية","مبنية؛ لا اختبار مجموعة جديد","يوجد إنشاء مجموعة وزر واجهة ومسارات عضوية؛ لا شهادة على كل صلاحيات الإدارة من اختبار اليوم.",W+"components/messenger/Messenger.tsx",1796,1822),
("إرسال نص","مبني؛ لم يُرسل نص جديد في هذا التدقيق","يُشفّر في الواجهة، يحفظ عبر send، مع تحقق المرسل وصلاحيات الغرفة ومنع إعادة الطلب المكرر.",S+"routes/messages.ts",1111,1145),
("استقبال Realtime","مبني؛ زمن الوصول غير مقاس الآن","بث authenticated /api/ws بعد حفظ الرسالة، وإضافة للغرفة المفتوحة. وجود fallback أو polling لا يجعل الاستقبال اللحظي غير موجود.",S+"routes/messages.ts",1327,1350),
("Seen","مبني مع خصوصية","lastReadAt مؤشر لكل عضو؛ مشاركة القراءة تؤثر على ما يرى الطرف الآخر. ✓✓ يعتمد على المؤشر.",W+"components/messenger/Messenger.tsx",2843,2890),
("Delivered مستقل","غير مثبت كميزة مستقلة","إقرار الخادم بالحفظ لا يساوي وصول الرسالة لجهاز المستلم. لا يوجد في الأدلة اختبار distinct delivered acknowledgment.","",0,0),
("Typing","مبني؛ لم يُختبر بين جلستين الآن","حدث chat-typing محدود المعدل ومقيد بعضوية الغرفة؛ الواجهة تمسح الحالة بعد مهلة.",S+"routes/messages.ts",40,62),
("صورة صغيرة","خدامة بالدليل في المعاينة","PNG مولّدة 99,946 بايت؛ start 200 وPUT 200 وcomplete 200 وsend 201؛ ظهرت للمستلم 182×182 دون crash. ليست صورة المستخدم الأصلية.",W+"components/messenger/directAttachmentUpload.ts",1,60),
("حدود الصور والملفات","مبنية؛ ليست سبباً مثبتاً لرفض 0.1MB","صور 5 MiB (5,242,880 بايت)، غير الصور 25 MiB (26,214,400 بايت)، قبل التشفير؛ سياسة الخادم تراعي ciphertext.",W+"components/messenger/attachment-policy.ts",1,20),
("فيديو في المحادثة","مبني؛ غير مختبر هنا","المرفق يُشفّر ويرفع ويعرض بعنصر video. فيديو الكليبس الناجح لا يثبت فيديو المراسلات.",W+"components/messenger/Messenger.tsx",1088,1110),
("ملف وصوت / voice note","مبني؛ سماع صوت حقيقي غير مثبت الآن","Blob مسجل أو ملف ثم نفس خط المرفقات؛ عنصر audio للعرض. لا قياس لجودة الصوت أو الميكروفون في هذا التدقيق.",W+"components/messenger/Messenger.tsx",1981,2046),
("مكان تخزين المرفقات","R2 للجديد؛ توافق تاريخي مع App Storage","chat/private وأسماء .enc. الملفات الخاصة تقرأ عبر route مصادق عليه يتحقق من عضوية محادثة تحتوي الرابط. لا ترحيل للقديم.",S+"routes/messages.ts",271,325),
("E2EE للنص والمرفقات","مبني؛ ليس تدقيقاً تشفيرياً مستقلاً","RSA-OAEP 2048/SHA256 لكل جهاز، AES-GCM256 للحمولة، مفاتيح خاصة CryptoKey غير قابلة للتصدير في IndexedDB. لا ادعاء Signal/Double Ratchet أو تدقيق forward secrecy.",W+"lib/amis-e2ee.ts",197,257),
("هوية جهاز التشفير","مبنية؛ فقدان المفتاح يمنع قراءة القديم","المفتاح الخاص محلي؛ العام مسجل بالخادم. لا يعني دخول نفس الحساب من جهاز جديد استعادة كل مفاتيح التاريخ.",W+"lib/amis-e2ee.ts",123,151),
("تشفير المرفقات","مبني واختُبر للصورة","AES-GCM قبل الرفع؛ metadata تحتوي المفتاح وIV داخل الرسالة المشفّرة. لا يرفع الملف كصورة عامة.",W+"lib/amis-e2ee.ts",269,288),
("ترجمة / smart composer","تنفيذ حقيقي، نجاح المزود الآن غير مختبر","زر يرسل supplied text إلى /api/ai/citizen-assistant بموافقة؛ الرد يوضع كمسودة. مشاركة النص مع AI تخرجه من حصره بين طرفي المحادثة.",W+"components/messenger/MessengerAssistant.tsx",127,179),
("تحقق موافقة AI","مبني في الخادم","يتطلب موافقة الحساب والطلب، ويمنع استخدام طلب الترجمة للاستعلام عن محادثات الآخرين. اعتماد المزود/رصيده لم يُختبر.",S+"routes/citizen-profiles.ts",199,265),
("حذف تلقائي","مبني؛ ليس إثبات إتلاف لكل النسخ","خيارات: ساعة،6،12،24،أسبوع،شهر،90يوماً. expiresAt على الرسالة؛ مسار القراءة يعالج المنتهي. لا ضمان أن نسخة في جهاز/ذاكرة/backup اختفت فوراً.",W+"components/messenger/Messenger.tsx",2407,2426),
("الحذف اليدوي والتفاعلات والكتم","مبني؛ غير مختبر الآن","DELETE الرسالة/الغرفة، reactions، mute وsettings موجودة ضمن فهرس API. وجود endpoint ليس شهادة على كل حالة CRUD.",S+"routes/messages.ts",1415,1435),
("المكالمة الصوتية داخل التطبيق","مبنية؛ تجربة ثنائية الطرف غير مثبتة هنا","إشارات WebSocket وحالة خادم؛ Agora متكامل. توجد أيضاً مسارات WebRTC؛ لا تخلط تشفير الرسائل مع E2EE للصوت، فهو غير مثبت بهذا التدقيق.",W+"hooks/useCall.ts",1,40),
("المكالمة المرئية","مبنية؛ لم تُختبر كاميرتان حقيقيتان","withVideo وAgora وCallOverlay موجودة؛ تصريح وجود الميزة لا يثبت جودتها على هاتفين.",W+"components/messenger/Messenger.tsx",1301,1321),
("أزرار الهاتف والكاميرا","مربوطة بالفعل","الزر يستدعي startCall؛ المجموعة لديها groupCall.startCall(mode). لا تفتح خط هاتف GSM ولا تضمن أن المستلم متصل.",W+"components/messenger/Messenger.tsx",2770,2805),
("سجل المكالمات","مبني باسم call_history","التسجيل في hook واحد ويأخذ answered ومدة الحديث؛ لا يوجد تعريف call_logs بالاسم المطلوب في مجموعة الكود المراجعة.",W+"hooks/useCall.ts",3035,3075),
("قفل المكالمات call_locks","غير مبني كجدول/بوابة دائمة حالياً","getBusyCallCandidate وrecoverBusyCall يعيدان null للتوافق. لا يعني ذلك غياب المعاملات أو التحقق من انتقالات حالة المكالمة.",S+"lib/call-signal-store.ts",175,192),
("مكالمات فائتة","مبنية؛ لا اختبار حديث لإشعار فعلي","MissedCallsInbox ومسارات /call-push/missed وحالة الخادم موجودة. لا ندّعي وصول push بمجرد وجود سجل.",S+"routes/call-push.ts",265,285),
("Android FCM background","مبني في الكود؛ تسليم هاتف حقيقي غير مثبت","setBackgroundMessageHandler موجود، Expo Go ليس binary صالحاً لإثبات هذه الوحدة.",M+"lib/call-service.native.ts",389,412),
("Android ringing/fullscreen","مبني؛ تشغيل الشاشة المقفولة غير مثبت","فحص full-screen intent permission وقناة رنين وnotification actions؛ قد تمنع الإعدادات/النظام/التثبيت السلوك، لا أحد منها سبب مثبت لحادثة المستخدم.",M+"lib/call-service.native.ts",226,271),
("شاشة الرد الأصلية","مبنية؛ لا فيديو تشغيل","GDNACallActivity وTelecom bridge؛ مكونات native تتطلب بناء وتثبيت جديدين لتحديثها.",M+"plugins/CallTelecomModule.kt",109,157),
("الصوت بعد الرد / Foreground service","مبني جزئياً/متكامل بالكود؛ غير مثبت على جهاز مغلق","GDNACallAudioService وstartForegroundService وبدء جلسة الوسائط؛ لا ادعاء نجاح الإذن أو audio route على جهاز المستخدم.",M+"plugins/CallTelecomModule.kt",205,232),
("APK حديث مجرّب","غير متوفر كدليل","APK موجود أقدم من تغيير 3 أكتوبر؛ لا تثبيت ولا اختبار ميداني جديد في هذا التدقيق.","",0,0),
("فيديو مكالمة خارج التطبيق","غير متوفر","لم يتم تسجيل فيديو هاتف حقيقي مقفول؛ لا يُستبدل بمحاكاة أو بلقطة متصفح.","",0,0),
]
# Exact current source excerpts are part of evidence; do not edit source for the report.
sections=[]
def add(title, body, ident):
    sections.append((ident,title,body))
def table(headers, rows):
    return "<table><thead><tr>"+ "".join("<th>"+esc(x)+"</th>" for x in headers)+"</tr></thead><tbody>"+ "".join("<tr>"+"".join("<td>"+str(x)+"</td>" for x in row)+"</tr>" for row in rows)+"</tbody></table>"
def p(text): return "<p>"+text+"</p>"
def source_link(path,a=0,b=0):
    if not path: return "لا يوجد مرجع تنفيذ يثبت الادعاء"
    ident="src-"+hashlib.sha1((path+str(a)+str(b)).encode()).hexdigest()[:12]
    return f'<a href="#{ident}"><code>{esc(path)}{":"+str(a)+"–"+str(b) if a else ""}</code></a>'

add("الحكم النهائي وحدود التدقيق", """
<div class="warning"><strong>المراسلات مبنية، وإرسال صورة صغيرة مشفّرة نجح فعلياً في المعاينة. مكالمات Android خارج التطبيق تحتوي تنفيذاً أصلياً، لكن نجاحها على هاتف مقفول لم يُثبت، ولا يوجد فيديو دليل. لا شهادة بأن APK الحالي يحتوي كل التغييرات.</strong></div>
<p>هذا تقرير وصفي للأكواد والتاريخ والأدلة، وليس تنفيذ إصلاحات جديدة. لم تُعدّل ملفات التطبيق أو قواعد البيانات أو إعدادات النشر أثناء إعداد هذه النسخة من التقرير. إنشاء ملفات التقرير ولقطة الدخول فقط لا يغير سلوك المنصة.</p>
<p>«مبني» = كود مرتبط بواجهة/خادم؛ «خدام بالدليل» = اختبار فعلي محدد؛ «غير مثبت» لا تعني «غير مبني». لا يجوز اختلاق عطل أو نجاح لتبسيط الجواب. جميع نتائج الصورة والفيديو السابقة تخص المعاينة إلا ما وُسم صراحة بالإنتاج.</p>
<p>النطاق: المكالمات والمراسلات /messages و/mes وامتدادهما الأصلي على Android. الكليبس ليس جزءاً من القسم، ويذكر فقط لفصل أدلة رفعه عن أدلة المراسلات. لم يتوفر محتوى المهمة #228 في ملفات المهام المحلية؛ التدقيق يفحص التنفيذ الفعلي لا يفترض أن عنوان مهمة يثبت الإنجاز.</p>
<p>لم يُنفذ اختبار اختراق، ولا جرد SQL لبيانات الإنتاج، ولا اتصال هاتف فعلي، ولا طلب AI مدفوع في هذا التدقيق. لا توجد صورة الخطأ الأصلية من المستخدم ضمن المرفقات المتاحة.</p>
""","summary")
links=[("المدخل الحالي الموصى به","/messages","صفحة التطبيق؛ تحتاج حساباً للمراسلات"),
("الاسم المختصر","/mes","مضاف في الكود بتاريخ 3 أكتوبر؛ لا تثبت استجابة SPA وحدها تطابق النسخة المنشورة"),
("استعادة سياق المراسلات عند الدخول","/login?next=%2Fmessages","حفظ الوجهة؛ لا يرسل كلمة مرور بالرابط"),
("التسجيل مع العودة للقسم","/register?next=%2Fmessages","لا تنشئ حساباً مكرراً إذا لديك حساب"),
("فحص جاهزية push","/api/call-push/config","GET قراءة عامة، ليست مكالمة اختبار"),
("النطاق الإضافي المنشور","https://gdna-arena.replit.app","مؤكد من معلومات النشر؛ ليس مشروعاً آخر")]
add("روابط القسم والتمييز بين المعاينة والإنتاج",table(["الاستعمال","الرابط","ملاحظة"],[[esc(a),f'<a href="{b}">{b}</a>',esc(c)] for a,b,c in links])+p("الأسماء البديلة في الكود: /message-calle، /messages.call، /messagerie، /message calle. المصدر: "+source_link(W+"lib/messages-entry.ts",1,22)+". العنوان العام مؤكد من خدمة النشر، لكن معلومات النشر لا تعطينا هنا بصمة bundle نقارنها بكل commit. آخر نشر ظاهر في سجل Git قبل إصلاح الرفع كان 59ff3e7 بتاريخ 2 أكتوبر 2026 23:57:07 UTC؛ عنوان commit ليس وحده سجل تشغيل كامل للنشر."),"links")
add("تاريخ البناء من أقدم نسخة موجودة",p("أقدم نسخة مراسلات وجدتها في التاريخ المحلي: <code>e19a384 — 2026-07-29T12:15:00Z</code>، في pages/messages.tsx، بتبويبي direct وgroups. ليس دليلاً على عدم وجود تاريخ أقدم خارج المستودع. ظهر Messenger المشترك في ba52dee بتاريخ 14 أغسطس. المسار /mes أضيف في 7d8e3c1 بتاريخ 3 أكتوبر، وليس هو تاريخ إنشاء المنتج.")+p("المرفق history.csv يسرد كل commits التي تمس ملفات الجرد، بالترتيب الزمني، بما فيها أسماء عامة مثل Published your App. الوصف هو عنوان commit، وليس شهادة اختبار أو سبب عطل. قد تظهر تغييرات غير خاصة بالقسم لأنها مست ملفاً مشتركاً.")+table(["التاريخ UTC","Commit","ما يثبته التاريخ"],[
["2026-07-29","e19a384","صفحة الرسائل القديمة بتبويبي الفردي والمجموعات"],
["2026-08-13","fb8db12","مؤشرات قراءة لكل عضو، والتحقق من الوصول"],
["2026-08-14","ba52dee","المكوّن المشترك Messenger"],
["2026-08-15","1e0fd78","تخزين المرفقات الدائم App Storage بدل القرص المحلي"],
["2026-08-16","2bf0462","دمج Agora والتحقق من المشاركين"],
["2026-08-20","9e48248 / 79f9587","صور متعددة وتقدّم الرفع؛ مؤشرات القراءة"],
["2026-09-01","a7d99df / 3a65d3d","معالجة فشل الوسائط وتبديل الأجهزة"],
["2026-09-13","82954ce","تغييرات Firebase push"],
["2026-09-29","926738d","إضافة ملف APK الموجود"],
["2026-10-03","7d8e3c1","رفع مباشر وصيانة معالجة أخطاء الرسائل وإضافة /mes"],
]),"history")
add("كل ميزة: الموجود والمثبت والناقص",table(["الميزة","الحالة","التفصيل","الكود"],[[esc(a),esc(b),esc(c),source_link(d,e,f)] for a,b,c,d,e,f in features]),"features")
add("مسارات البيانات: ماذا يحدث عند الضغط؟","""
<h3>النص</h3><p>جلسة المستخدم → التحقق من الغرفة ومفاتيح أجهزة المستلمين → تشفير محلي → POST send → التحقق من المرسل والعضوية/الحظر → حفظ dm_messages → بث /api/ws → فك التشفير على جهاز المستلم → تحديث مؤشر القراءة عند العرض. لا تعني الاستجابة 201 أن المستخدم قرأ الرسالة.</p>
<h3>الصورة/الفيديو/الملف/الصوت</h3><p>اختيار/تسجيل → فحص الحجم → AES-GCM في المتصفح → start مصادق عليه للغرفة → تذكرة خادم ورابط مؤقت → PUT واحد للـciphertext مع If-None-Match → complete يتحقق من حجم ونوع الكائن → إرسال metadata مشفّرة في الرسالة → قراءة خاصة عبر /api/messages/files → فك محلي → عرض. الرابط العام غير مطلوب ولا تُرفع المفاتيح الخاصة إلى R2.</p>
<h3>مكالمة التطبيق</h3><p>زر الهاتف/الكاميرا → startCall → إشارات وحالة مصادق عليهما → رنين واجهة/إشعار بحسب حالة المستلم → قبول صريح → طلب صلاحيات وسائط/token للمشارك → جلسة Agora أو مسار الوسائط المحدد → إنهاء وتسجيل النتيجة. تشفير رسائل AES-GCM لا يثبت E2EE للمكالمة الصوتية.</p>
<h3>خارج التطبيق</h3><p>تسجيل جهاز native مصادق عليه → إرسال FCM → استلام background handler أو تشغيل native → التحقق من المكالمة والمستلم والصلاحية → full-screen/call notification → قبول صريح → خدمة صوت/وسائط. كل سهم يمكن أن يفشل بشكل مستقل؛ enabled:true لا يختبر السلسلة كلها.</p>
""","flows")
add("الأعطال: المسؤولية والسبب المثبت مقابل الافتراض","""
<table><tr><th>الواقعة</th><th>ما ثبت</th><th>ما لم يثبت</th></tr>
<tr><td>الصورة 0.1 MB</td><td>أصغر من الحد؛ نجحت صورة تجريبية بعد الإصلاح في المعاينة، وظهرت للمستلم.</td><td>لا توجد استجابة طلب المستخدم الأصلية ولا لقطة أصلية متاحة. http://gallery.jpg ليس تشخيصاً. لا أجزم أن سبب تلك الحادثة CORS أو التشفير.</td></tr>
<tr><td>تعذر تحميل الصفحة</td><td>النص في main.tsx يظهر من catch عند تحميل/إقلاع app-entry. سجل سابق عرض Application startup failed مع {}.</td><td>لا stack trace تفصيلي يربط حادثة المستخدم بسطر معين. لا دليل أنها بسبب الصورة أو فك التشفير.</td></tr>
<tr><td>فشل فك التشفير</td><td>try/catch للنص والاقتباس والمرفق، وحماية لكل عنصر في التحميل والبث. الجهاز بلا مفتاح قد يعجز عن قراءة التاريخ.</td><td>لا دليل أن هذه الحالات سببت الشاشة البيضاء المبلغ عنها. وجود catch ليس ضماناً ضد كل crash في الشجرة.</td></tr>
<tr><td>فشل presign في اختبار الكليبس السابق</td><td>خطأ في الإصلاح السابق نفسه: بادئة مفتاح لا يسمح بها r2Reference؛ أصلح قبل النجاح.</td><td>ليس دليلاً أن الخطأ نفسه كان في مرفق المراسلات أو في الإنتاج.</td></tr>
<tr><td>CORS في الرفع السابق</td><td>اختبار المتصفح أثبت رفض preflight؛ عُدلت القاعدة سابقاً ثم نجح PUT الحقيقي. هذه الواقعة مثبتة.</td><td>لا تكفي لإسناد كل أخطاء المستخدم القديمة إلى CORS.</td></tr>
<tr><td>APK ووثيقة التحقق</td><td>بصمة الملف الحالي مختلفة عن بصمة مذكورة في أول وثيقة native-call-device-checklist؛ فيها أيضاً وصف قديم لحصة عشر رسائل.</td><td>لا يمكن اعتمادها كشهادة مطابقة للنسخة الحالية. الاختلاف وحده ليس دليلاً على فساد APK.</td></tr>
</table>
<h3>نواقص بنيوية تزيد صعوبة التشخيص، وليست أسباباً مؤكدة لكل حادثة</h3>
<ul><li>تعدد web/native، وAgora/WebRTC، وR2/App Storage التاريخي يتطلب تمييز المسار الجاري فعلاً.</li>
<li>الرسالة العامة عند فشل الإقلاع لا تعطي المستخدم سبباً، والسجل المتاح لا يحتوي stack قابلاً للتحليل.</li>
<li>الخلط بين نجاح build، وجاهزية المزود، ووصول الإشعار، ورنين هاتف حقيقي ينتج تقارير نجاح غير كافية.</li>
<li>عدم ربط APK ببصمة المصدر واختبار جهاز موثّق يمنع تحديد النسخة التي يستعملها المستخدم.</li>
<li>وجود طبقات توافق قديمة لا يعني أنها المسار الجديد؛ يجب ألا نلغي تاريخ المستخدمين لمجرد تنظيف أسماء الملفات.</li>
<li>Delivered المستقل عن حفظ الخادم غير مثبت. الحذف التلقائي لا يثبت مسح جميع النسخ المحلية/الاحتياطية.</li></ul>
""","failures")
readiness = {"checkedAtUtc":stamp,"source":"/api/call-push/config"}
try:
    with urllib.request.urlopen(readiness["source"], timeout=20) as resp:
        data=json.load(resp); readiness["httpStatus"]=resp.status
    for k in ("enabled","pushEnabled","callAuthorityReady","reason","pushReason"):
        if k in data: readiness[k]=data[k]
except Exception as error:
    readiness["error"]=type(error).__name__
(OUT/"production-readiness.json").write_text(json.dumps(readiness,ensure_ascii=False,indent=2))
apk=ROOT/"downloads/GDNA-Arena-Android.apk"
apk_hash=hashlib.file_digest(apk.open("rb"),"sha256").hexdigest() if apk.exists() else "غير موجود"
add("Android / FCM / APK: الحالة الدقيقة",p("قراءة الإنتاج الحالية، مع استبعاد config ومفاتيح العميل والـtokens من التقرير:")+f"<pre>{esc(json.dumps(readiness,ensure_ascii=False,indent=2))}</pre>"+"""
<p>FIREBASE_SERVICE_ACCOUNT موجود في بيانات أسرار الإنتاج. getCallPushStatus يفحص configurationProblem ويحاول loadServices؛ نجاحه يثبت التهيئة البرمجية المطلوبة لهذا endpoint، لا وصول إشعار من مزود FCM ولا شهادة سلامة هاتف المستخدم. لم تُقرأ قيمة السر.</p>
<p>Foreground Service مبنية في Android، وService Worker للويب شيء مختلف. الرنين والصوت وشاشة الرد توجد لها أكواد، لكن الاختبار النهائي على هاتف مقفول <strong>غير مُنجز كدليل متاح</strong>. فيديو الدليل <strong>غير متوفر</strong>. لا يصح وصف الأكواد بأنها غير مبنية، ولا وصف التسليم النهائي بأنه خدام.</p>
"""+p("الملف الموجود: <code>downloads/GDNA-Arena-Android.apk</code>، "+str(apk.stat().st_size if apk.exists() else 0)+" بايت. آخر commit للملف 926738d — 2026-09-29T20:15:43Z. بصمته المحسوبة الآن:")+f"<pre>{apk_hash}</pre>"+p("لم يُبنَ APK جديد في هذا التدقيق. لا ادعاء أن تعديل web أو نشر السيرفر يحدث خدمات Android الأصلية في APK مثبت قديماً. وثيقة قائمة الاختبار القديمة تصرح أيضاً ببقاء إثبات الجهاز الفعلي وFCM الحي معلقين."),"android")
schemas=[p for p in files if p.startswith("lib/db/src/schema/")]
schema_rows=[]
for path in schemas:
    text=(ROOT/path).read_text()
    for match in re.finditer(r'pgTable\("([^"]+)"',text):
        schema_rows.append([esc(match[1]),f'<code>{esc(path)}:{text[:match.start()].count(chr(10))+1}</code>'])
add("الجداول والحالة والمفاتيح",p("الجداول التالية مستخرجة من ملفات schema المحددة في الجرد. تشمل جداول داعمة للاجتماعي والهوية. هذا ليس SELECT من قاعدة الإنتاج، ولا ادعاء أن كل migration مطبّق هناك. لا جداول call_logs أو call_locks في هذه التعريفات؛ السجل call_history، والحالة call_state_documents. أسماء Firestore-like callInvites/events وusers/devices/sessions/missedCalls تظهر في طبقة التنفيذ، ولا ينبغي تحويلها تلقائياً إلى أسماء جداول SQL.")+table(["الاسم","مصدر التعريف"],schema_rows),"db")
env_names=set()
for path in files:
    if label(path)!="تنفيذ / إعداد": continue
    text=(ROOT/path).read_text(errors="replace")
    env_names.update(re.findall(r'process\.env\.([A-Z][A-Z0-9_]+)',text))
add("الأسرار والإعدادات المستخدمة — أسماء فقط",p("وجود الاسم في المصدر يعني أن الكود يقرأه، وليس أنه مضبوط في كل بيئة. Secret وenvironment variable ليسا الشيء نفسه. تم التأكد سابقاً من وجود أسرار الإنتاج: FIREBASE_SERVICE_ACCOUNT، AGORA_APP_CERTIFICATE، R2_ACCESS_KEY_ID، R2_SECRET_ACCESS_KEY، SESSION_SECRET، TURN_SHARED_SECRET. AGORA_APP_ID ليس Secret بحسب بيانات الفحص، وقد يكون إعداداً عادياً؛ لا أستنتج أنه مفقود. القائمة الآلية تشمل خيارات legacy واختيارات بيئات مختلفة، لا يلزم جميعها معاً.")+"<pre>"+esc("\n".join(sorted(env_names)))+"</pre>","env")
add("فهرس API: الروابط والأفعال ومكان التنفيذ",p("مستخرج من router في ملفات المسارات المحددة، مع بادئة /api. لا تنفّذ POST/DELETE بمجرد فتح التقرير. :id وأشباهها متغيرات، وليست روابط قابلة للاستعمال دون رقم وصلاحية. هذا جرد للكود، لا اختبار حي لكل endpoint. لا يشمل بروتوكول رسائل WebSocket كأنه REST.")+table(["الفعل","المسار","الملف والسطر"],[[esc(a),f"<code>{esc(b)}</code>",f"<code>{esc(c)}:{d}</code>"] for a,b,c,d in routes]),"api")
add("دليل الاختبارات والصور وما لم يُختبر", """
<ul><li>اختبار سابق في المعاينة: صورة تجريبية PNG 99,946 بايت؛ round-trip كامل مع recipient image complete=true، 182×182. لا تعديل لمستخدم حقيقي؛ حسابات QA.</li>
<li>الكليبس: 130,850,401 بايت،60.1 ثانية،presign/PUT/confirm كلها200 وتطابق SHA256 كامل. دليل لقسم آخر، لا يُستخدم لإثبات فيديو المراسلات.</li>
<li>30 اختباراً موجهاً سابقاً: 27 تخص الكليبس و3 directAttachmentUpload للمراسلات. هذه ليست «30 اختباراً لكل قسم المكالمات».</li>
<li>TypeScript وبناء web نجحا في عمل الإصلاح السابق. لم تُعاد الآن لأنها لا تثبت ميزة مستخدم جديدة ولا تغيير في الكود.</li>
<li>لا اختبار صوت/كاميرا حقيقي ثنائي الطرف، ولا مجموعة، ولا AI فعلي، ولا مرور زمن الحذف، ولا typing/seen بين جلستين في هذا التدقيق الحالي.</li>
<li>لا screenshot لكل ميزة خدامة؛ المتوفر من الاختبار السابق screenshot الصورة لدى المستلم عُرض في المحادثة. لا أضع صورة synthetic PNG وحدها على أنها لقطة نجاح.</li>
<li>اللقطة الجديدة أدناه: /mes دون جلسة على عرض390×844 في المعاينة، تثبت شاشة الدخول وعزل المسار فقط، لا محادثة أو اتصال ناجحاً.</li></ul>
"""+(f'<figure><img alt="المعاينة: شاشة دخول المراسلات دون جلسة، ليست إثبات اتصال" src="data:image/jpeg;base64,{base64.b64encode((OUT/"mes-signed-out.jpg").read_bytes()).decode()}"><figcaption>لقطة تدقيق جديدة، دون تسجيل دخول. 401 الخاص بفحص الجلسة متوقع في هذه الحالة.</figcaption></figure>' if (OUT/"mes-signed-out.jpg").exists() else ""),"evidence")
add("ما يمنع إعلان التسليم النهائي؟","""
<ol><li><strong>مطابقة الإنتاج للكود:</strong> endpoint جاهزية FCM تحقق منه في الإنتاج، لكن تدفق الصورة المصحّح أثبت في المعاينة. يلزم دليل أن bundle/API المنشورين يحتويان الإصلاح؛ لا توجد إعادة نشر خلال هذا التقرير.</li>
<li><strong>تشخيص crash المستخدم:</strong> يلزم stack/network failure للحادثة نفسها. لا يكفي النص العام. السبب الجذري الآن غير محسوم.</li>
<li><strong>هاتف مقفول:</strong> نحتاج إثبات استقبال FCM للجهاز الصحيح، رنين، شاشة رد، قبول صريح، صوت بالاتجاهين، إنهاء وإلغاء. force-stop حالة مختلفة يجب توثيقها ولا نَعِد بتجاوز سياسات Android.</li>
<li><strong>APK محدد:</strong> مصدر commit وبصمة APK وتاريخ build وتثبيت فعلي موثق، بما يشمل الترقية من النسخة القديمة والصلاحيات. الملف القديم ليس إثباتاً لذلك.</li>
<li><strong>خصائص غير مختبرة:</strong> Delivered المستقل، الصوت/الفيديو والملفات، المجموعة، Seen/Typing، AI، الحذف التلقائي. الكود يثبت البناء؛ الاختبار وحده يثبت السلوك.</li>
<li><strong>فيديو الدليل:</strong> غير متوفر؛ لذلك لا يوجد تسليم مثبت للمكالمة خارج التطبيق.</li></ol>
<p>هذه فجوات قبول وتوثيق وليست أمراً بتنفيذ تغييرات. لم أبدأها، ولم أطلب أسراراً جديدة أو أغير إعدادات Firebase/Android.</p>
""","gaps")
add("جرد الملفات القابل للبحث والتحقق",p(f"عدد الملفات في النطاق المعلن: {len(files)}. تم اختيار ملفات web/server/mobile/schema المرتبطة بالرسائل والمكالمات والتشفير والإشعارات بأسمائها، مع ملفات مشتركة صريحة للبدء والهوية والتوجيه والتخزين. يشمل الاختبارات والوثائق ونسخ Android المولدة المطابقة للاختيار. يستبعد node_modules وملفات credentials وAPK والأصول الثنائية. ليس كل شجرة اعتماد الحزمة أو كل ملف في المشروع. ملف CSV المرفق يعطي SHA256 وعدد الأسطر لكل ملف؛ يمكن معرفة إن تغير المصدر بعد التقرير.")+table(["النوع","المسار"],[[esc(label(f)),f"<code>{esc(f)}</code>"] for f in files]),"inventory")
add("السجل الكامل للتغييرات في نطاق الجرد",p(f"عدد commits المطابقة: {len(history)}. تواريخ author كما يخزنها Git؛ ليست جميعها أوقات نشر. الأسطر تقرأ عبر git show COMMIT -- FILE لمراجعة التغيير الفعلي. المرفق history.csv يحفظ النسخة الكاملة.")+table(["التاريخ","Commit","العنوان الأصلي"],[[esc(t),f"<code>{h}</code>",esc(s)] for h,t,s in history]),"full-history")
excerpts=[]
seen=set()
extra=[(W+"main.tsx",55,70),(W+"components/messenger/Messenger.tsx",1015,1090),(S+"lib/firebase-call-push.ts",783,810),(S+"lib/chat-direct-upload.ts",1,45),(W+"lib/messages-entry.ts",1,22)]
for path,a,b in [(d,e,f) for _,_,_,d,e,f in features if d]+extra:
    ident="src-"+hashlib.sha1((path+str(a)+str(b)).encode()).hexdigest()[:12]
    if ident in seen: continue
    seen.add(ident)
    lines=(ROOT/path).read_text().splitlines()
    body="\n".join(f"{i+1:04d}  {line}" for i,line in enumerate(lines) if a-1<=i<b)
    excerpts.append(f'<details id="{ident}"><summary>{esc(path)}:{a}–{b}</summary><pre>{esc(body)}</pre></details>')
add("مقتطفات الكود الأصلية بالأرقام",p("هذه مقتطفات مقروءة من المصدر عند إعداد التقرير، وليست كوداً جديداً أو اقتراحاً لإعادة البناء. النقر على مرجع ميزة يقود لهذا الملحق. أرقام الأسطر قابلة للتغير بعد التعديل؛ بصمة المصدر في الجرد تحدد النسخة.")+"".join(excerpts),"code")

nav="<nav>"+"".join(f'<a href="#{ident}">{i+1}. {title}</a>' for i,(ident,title,_) in enumerate(sections))+"</nav>"
body="".join(f'<section id="{ident}"><h2>{i+1}. {title}</h2>{content}</section>' for i,(ident,title,content) in enumerate(sections))
doc=f"""<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Helixly — التقرير الكامل للمكالمات والمراسلات</title>
<style>body{{font:16px/1.9 system-ui,sans-serif;color:#17212b;background:#fff;margin:0}}main{{max-width:1250px;margin:auto;padding:32px}}h1,h2,h3{{line-height:1.5}}header{{border-bottom:4px solid #a57921;padding-bottom:20px}}nav{{display:grid;gap:5px;padding:20px;background:#f3f5f8}}a{{color:#174e89;overflow-wrap:anywhere}}section{{padding:20px 0;border-bottom:1px solid #d3dbe5}}table{{border-collapse:collapse;width:100%;font-size:14px}}td,th{{border:1px solid #cbd3df;padding:10px;vertical-align:top;text-align:right;overflow-wrap:anywhere}}th{{background:#f0f3f7}}code,pre{{direction:ltr;text-align:left;font:12px/1.7 ui-monospace,monospace;overflow-wrap:anywhere}}code{{display:inline-block;max-width:100%}}pre{{white-space:pre-wrap;background:#f2f4f7;padding:15px;overflow:auto}}details{{border:1px solid #ddd;padding:12px;margin:8px 0}}summary{{direction:ltr;text-align:left;cursor:pointer;overflow-wrap:anywhere}}.warning{{background:#fff4d8;border-right:5px solid #a57921;padding:20px}}img{{max-width:390px;width:100%;height:auto}}figcaption,small{{color:#4c5b6c}}@media(max-width:700px){{main{{padding:12px}}table{{display:block;overflow-x:auto}}}}@media print{{nav{{display:none}}details{{display:block}}pre{{font-size:9px}}}}</style></head>
<body><main><header><h1>تقرير القسم من البناء إلى الآن<br>المكالمات والمراسلات — Helixly</h1><p>التاريخ: {esc(stamp)} UTC<br>لقطة المصدر: <code>{head}</code></p>
<p>تقرير تقني بالأدلة: الموجود، المكسّر المثبت، غير المثبت، والناقص. روابط + كود + تاريخ + API + جداول + Android/APK + حدود الاختبار.</p></header>{nav}{body}<footer><p>نهاية التقرير. لا قيم أسرار، لا tokens، لا روابط رفع موقعة، لا بيانات محادثات المستخدمين. مصدر الحقائق: الملفات المحلية وGit وطلب جاهزية عام ونتائج الاختبارات السابقة الموصوفة صراحة.</p></footer></main>
<script>function openEvidence(){{const el=document.getElementById(location.hash.slice(1));if(el&&el.tagName==='DETAILS')el.open=true;}}addEventListener('hashchange',openEvidence);openEvidence();</script></body></html>"""
(OUT/"helixly-messenger-complete-audit.html").write_text(doc,encoding="utf-8")
print(json.dumps({"source":head,"files":len(files),"commits":len(history),"apiRoutes":len(routes),"features":len(features),"htmlBytes":len(doc.encode()),"readiness":readiness},ensure_ascii=False))