# Awakened — App Store metadata

Source of truth for App Store Connect copy. Closes the gap identified in
W189-Prep §3 (subtitle / description / what's-new copy not previously
tracked in repo — only in App Store Connect, lost when sessions reset).

Update this file every time App Store Connect metadata changes.

---

## 3.0.10 — READY TO PASTE (W1023, final 2026-10-04, HEAD `112df7f`, tag `3.0.10-w1024`)

One change: the 9:45 PM finish-strong reminder. Four languages, each far under the
4,000-character limit. Banned-word check done. Promotional text: keep 3.0.9's.

**Before submitting:** DeepSeek in the privacy policy / App Privacy answers is still
owed from 3.0.9 (see the 3.0.9 section).

### English (U.S.)

```
Finish strong.

• A late reminder, only when you've earned it. If you've sealed most of today's vows, or have just one left, Awakened sends one reminder at 9:45 PM to close out a perfect day. With one vow left, it names it. Everyone else hears nothing.

• It respects your Quiet Hours and your reminder settings.
```

### Spanish (Mexico)

```
Termina con fuerza.

• Un recordatorio tardío, solo cuando te lo ganaste. Si ya cumpliste casi todos los votos de hoy, o te falta solo uno, Awakened te envía un recordatorio a las 9:45 p. m. para cerrar un día perfecto. Si te falta un voto, te dice cuál. Los demás no reciben nada.

• Respeta tus Horas de Silencio y tu configuración de recordatorios.
```

### Japanese

```
最後までやり切る。

• がんばった日だけ届く、夜のリマインダー。今日の誓いのほとんどを果たしているか、残りがあとひとつのとき、午後9時45分に一度だけ通知が届き、パーフェクトデーの仕上げを後押しします。残りがひとつなら、その誓いの名前も表示します。それ以外の人には届きません。

• おやすみ時間とリマインダーの設定はそのまま尊重されます。
```

### Norwegian (Bokmål)

```
Avslutt sterkt.

• En sen påminnelse, bare når du har fortjent den. Har du fullført de fleste av dagens løfter, eller har bare ett igjen, sender Awakened én påminnelse klokken 21.45 for å lande en perfekt dag. Er det ett løfte igjen, nevner den hvilket. Alle andre får ingenting.

• Den respekterer stilletidene og påminnelsesinnstillingene dine.
```

## 3.0.9 — READY TO PASTE (W1002–W1022, final 2026-10-02, HEAD `6c5c9c4`)

Four languages. Each block is under the 4,000-character limit. Banned-word check
done (no "fell"/"felled"). Left out on purpose: the update banner on resume (W1007,
plumbing), the TO-DO badge count (W1016, a correction), the removed Routine Progress
popup and Status Window button, and the old-account move to the new Jump Program.

**Before submitting:**
- **DeepSeek.** The Monday recap sends last week's numbers and up to three vow names
  (no name, no account id) to DeepSeek to be worded. Add DeepSeek to the privacy policy
  (hosted on Netlify, not in this repo) and review the App Privacy answers. Apple's
  guideline 5.1.2(i) asks for disclosure and permission before personal data goes to a
  third-party AI; whether vow names count is a judgement call, so say what is sent in
  the App Review notes.
- **Build.** Submit a build cut from `6c5c9c4` (Tree identity tag `3.0.9-w1022`).
- The in-app What's New sheet has no 3.0.9 entry (its last is 3.0.7). Updaters simply
  see no sheet; adding one needs a new build.

### English (U.S.)

```
Plan the week. Train on your days.

• Plan the whole week. The To-do tab now lays your tasks out Monday to Sunday. Drag one to another day, or add it to several days at once. Make it repeat: weekly, monthly, or a set number of days after you finish it. A NOTE button in the add bar keeps the details (a grocery list, an address).

• To-dos are for keeping track, not for points. Add as many as you like. They no longer pay XP; your vows do.

• A briefing that starts with what's due. Your morning briefing opens with today's to-dos, and if you have none yet you can add your first right there, for any day this week. Mondays open with a short recap of the week you just had, written for you.

• Vows that fit a real week. Set a vow to a number of times a week (the gym four times, any days). Skipping Monday never breaks Monday; the week only breaks if you come up short.

• See what's left from anywhere. Tap the vows counter at the top to open the vows still open today, and seal them right there.

• A Status tab that moves. Every stat level gets its own LEVEL UP moment, your hunter stands beside your stats and glows gold when the day is sealed, and one button shares your card.

• Vertical Jump Program, rebuilt. Four sessions in every 14 days: two plyometric, two strength, each listed in order with its sets. Pick the day you start, and the app tells you which day you're on and when the next session is.

• Fixes. Stair-climb hunts now show each hunter's flights and the true time. A new week's Worldgate no longer reads as last week's. When the Worldgate is down, your share says your step count froze at the kill.
```

### Spanish (Mexico)

```
Planea la semana. Entrena en tus días.

• Planea toda la semana. La pestaña Pendientes ahora ordena tus tareas de lunes a domingo. Arrastra una a otro día o agrégala a varios días a la vez. Haz que se repita: cada semana, cada mes o cierto número de días después de terminarla. Un botón de NOTA en la barra de agregar guarda los detalles (la lista del súper, una dirección).

• Los pendientes son para organizarte, no para sumar puntos. Agrega todos los que quieras. Ya no dan XP; tus votos sí.

• Un resumen que empieza por lo que vence. Tu resumen matutino abre con los pendientes de hoy y, si aún no tienes ninguno, puedes agregar el primero ahí mismo, para cualquier día de esta semana. Los lunes abre con un repaso breve de la semana que acabas de tener, escrito para ti.

• Votos que caben en una semana real. Pon un voto en un número de veces por semana (el gimnasio cuatro veces, los días que sea). Saltarte el lunes no rompe el lunes; la semana solo se rompe si te quedas corto.

• Ve lo que falta desde cualquier lugar. Toca el contador de votos de arriba para abrir los que siguen abiertos hoy y cumplirlos ahí mismo.

• Una pestaña Estado con vida. Cada nivel de atributo tiene su propio momento de subida de nivel, tu cazador aparece junto a tus atributos y brilla en dorado cuando completas el día, y un solo botón comparte tu tarjeta.

• Programa de Salto Vertical, renovado. Cuatro sesiones cada 14 días: dos de pliometría y dos de fuerza, cada una en orden y con sus series. Elige el día en que empiezas y la app te dice en qué día vas y cuándo es la próxima sesión.

• Correcciones. Las cacerías de escaleras ahora muestran los pisos de cada cazador y el tiempo real. La Worldgate de una semana nueva ya no aparece como la de la semana pasada. Cuando la Worldgate es derrotada, tu parte avisa que tu conteo de pasos se congeló en ese momento.
```

### Japanese

```
一週間を計画する。自分の日に鍛える。

• 一週間まるごと計画。やることタブが月曜から日曜までの並びになりました。別の日へドラッグしたり、複数の日にまとめて追加したりできます。繰り返しも設定できます：毎週、毎月、または完了から指定した日数後。追加バーの「メモ」ボタンで、買い物リストや住所などの詳細を残せます。

• やることは整理のためのもので、ポイント稼ぎのためではありません。いくつでも追加できます。XPは付かなくなりました。XPを生むのは誓いです。

• 期日から始まるブリーフィング。朝のブリーフィングは今日のやることを最初に表示します。まだひとつもなければ、その場で今週の好きな日に最初のひとつを追加できます。月曜日は、先週をふり返るあなた向けの短いまとめから始まります。

• 現実の一週間に合う誓い。誓いを「週に何回」で設定できます（ジムを週4回、曜日は自由）。月曜に休んでも月曜は途切れません。回数が足りなかったときだけ、その週が途切れます。

• どこからでも残りを確認。画面上部の誓いカウンターをタップすると、今日まだ残っている誓いが開き、その場で果たせます。

• 動きのあるステータスタブ。ステータスのレベルが上がるたびにレベルアップの演出が入り、ハンターがステータスの横に立ち、一日をやり切ると金色に輝きます。カードの共有はボタンひとつです。

• 垂直跳びプログラムを一新。14日間に4回のセッション：プライオメトリクス2回、筋力2回。それぞれ順番どおりに、セット数つきで表示します。開始日を選べば、今が何日目か、次のセッションがいつかをアプリが教えてくれます。

• 修正。階段ハントの結果に、各ハンターが上った階数と正しい所要時間が表示されるようになりました。新しい週のWorldgateが先週のものとして表示される問題を修正しました。Worldgate撃破後、歩数が撃破時点で確定したことを表示します。
```

### Norwegian (Bokmål)

```
Planlegg uken. Tren på dine dager.

• Planlegg hele uken. Gjøremål-fanen legger nå oppgavene dine ut fra mandag til søndag. Dra en til en annen dag, eller legg den til på flere dager samtidig. La den gjenta seg: ukentlig, månedlig eller et bestemt antall dager etter at du er ferdig. En NOTAT-knapp i legg til-feltet tar vare på detaljene (handlelisten, en adresse).

• Gjøremål er for oversikt, ikke for poeng. Legg til så mange du vil. De gir ikke lenger XP; det gjør løftene dine.

• En briefing som starter med det som forfaller. Morgenbriefen åpner med dagens gjøremål, og har du ingen ennå, kan du legge til det første der og da, for hvilken som helst dag denne uken. Mandager åpner med en kort oppsummering av uken du nettopp hadde, skrevet til deg.

• Løfter som passer en ekte uke. Sett et løfte til et antall ganger i uken (trening fire ganger, hvilke dager som helst). Å hoppe over mandag bryter aldri mandagen; uken brytes bare hvis du kommer til kort.

• Se hva som gjenstår, uansett hvor du er. Trykk på løftetelleren øverst for å åpne løftene som fortsatt står åpne i dag, og fullfør dem der.

• En Status-fane som lever. Hvert nytt nivå får sitt eget øyeblikk, jegeren din står ved siden av egenskapene dine og lyser gull når dagen er fullført, og én knapp deler kortet ditt.

• Vertikalhopp-programmet, bygget på nytt. Fire økter hver 14. dag: to plyometriske og to styrkeøkter, hver i riktig rekkefølge med settene sine. Velg dagen du starter, så forteller appen hvilken dag du er på og når neste økt er.

• Rettelser. Trappejakter viser nå hver jegers etasjer og riktig tid. En ny ukes Worldgate vises ikke lenger som forrige ukes. Når Worldgate er nede, sier din andel at skrittellingen ble låst i det øyeblikket.
```

### Promotional text (170 max; can change any time without review)

- **English (164):** Plan your week beside your vows: to-dos by day, vows a few times a week, a briefing that starts with what's due, and a Jump Program that begins on the day you pick.
- **Spanish (161):** Planea tu semana junto a tus votos: pendientes por día, votos varias veces por semana, un resumen que empieza por lo que vence y un Programa de Salto a tu ritmo.
- **Japanese (67):** 誓いの隣で一週間を計画。日ごとのやること、週に数回の誓い、期日から始まるブリーフィング、そして好きな日に始められる垂直跳びプログラム。
- **Norwegian (164):** Planlegg uken ved siden av løftene dine: gjøremål per dag, løfter noen ganger i uken, en briefing som starter med det som forfaller, og et hopp-program fra din dag.

## 3.0.8 — READY TO PASTE (W989–W1001, final 2026-09-25, build 551)

Four languages. Each block is under the 4,000-character limit. Banned-word check
done (no "fell"/"felled"). Left out on purpose: the moderator-only view counts
(W994), the owner/mod preview rows, and the drag fix (W997 — a fix, not a feature).
Revised 2026-09-25 to carry W1000 (to-dos v2) and W1001 (edit a topic).

**Before submitting:** the three description corrections below (Ranked PvP, Streak
Shields, the five-hunter raid = Premium) go out WITH this version — a description only
changes with a new version, and 3.0.7 shipped without them. The subtitle idea
("Habit Tracker, Boss Battles") is the other open item from the 3.0.7 review.

### English (U.S.)

```
The day in three parts. And the loose ends.

• Your vows now read like a day. The Habits tab groups them into MORNING, DAY and EVENING, each with its own count. The part of the day it is sits lit. Finish every vow in a section and it folds itself away so the rest comes into view.

• Put any vow where it belongs. Drag it by the grip to reorder, or into another part of the day. New and edited vows get a TIME OF DAY choice.

• To-dos. One-off tasks now live beside your vows, grouped by day: OVERDUE, TODAY, TOMORROW, LATER, SOMEDAY. Give one a due day, a reminder and a note; mark it PRIORITY to sit it first. Swipe left to postpone or delete, tap the text to edit, tick the box for +1 XP (five a day). Deleting offers UNDO. Your morning briefing tells you what's due.

• Relics you can read. Every relic wears its rank letter, E through S, so strength is obvious at a glance. NEW means new: it clears once you've looked. One colour per rarity, everywhere.

• Fairer drops. E-rank gates are generous; each rank up drops a little less. Rare and ultra-rare protection now covers every boss, including A and S. Twenty-four relics were re-balanced so a higher rank is never weaker than a lower one.

• The Community board. Edit a post you wrote, and see RESOLVED on reports that have been handled.
```

### Spanish (Mexico)

```
El día en tres partes. Y los pendientes.

• Tus votos ahora se leen como un día. La pestaña Hábitos los agrupa en MAÑANA, DÍA y NOCHE, cada uno con su cuenta. La parte del día en la que estás se ilumina. Completa todos los votos de una sección y se pliega sola para dejar ver el resto.

• Pon cada voto donde corresponde. Arrástralo por el asa para reordenarlo o llevarlo a otra parte del día. Los votos nuevos y editados tienen una opción de MOMENTO DEL DÍA.

• Pendientes. Las tareas de una sola vez ahora viven junto a tus votos, agrupadas por día: VENCIDAS, HOY, MAÑANA, MÁS ADELANTE, ALGÚN DÍA. Ponles fecha, recordatorio y una nota; márcalas como PRIORIDAD para que vayan primero. Desliza a la izquierda para posponer o borrar, toca el texto para editar, marca la casilla por +1 XP (cinco al día). Borrar ofrece DESHACER. Tu informe matutino te dice qué vence hoy.

• Reliquias que se entienden. Cada reliquia lleva su letra de rango, de E a S, para que su fuerza se vea de un vistazo. NUEVO significa nuevo: se quita cuando la miras. Un color por rareza, en todas partes.

• Botín más justo. Las puertas de rango E son generosas; cada rango superior suelta un poco menos. La protección de raras y ultra raras cubre ahora a todos los jefes, incluidos A y S. Veinticuatro reliquias se reequilibraron para que un rango mayor nunca sea más débil que uno menor.

• El tablero de la Comunidad. Edita una publicación que escribiste y ve RESUELTO en los reportes que ya se atendieron.
```

### Japanese

```
一日を三つに。そして、やり残しを。

• 誓いが一日の流れで読めるようになりました。習慣タブは誓いを「朝」「昼」「夜」に分け、それぞれに達成数を表示します。今の時間帯が光ります。ひとつの区分の誓いをすべて果たすと自動で折りたたまれ、残りが見やすくなります。

• 誓いを好きな場所へ。つまみをドラッグして並べ替えたり、別の時間帯へ移したりできます。新規・編集時に「時間帯」を選べます。

• やることリスト。一回きりの用事を誓いの隣に、日ごとにまとめて表示します：期限切れ・今日・明日・あとで・いつか。期日・リマインダー・メモを付け、「優先」にすれば先頭に。左にスワイプで延期や削除、文字をタップで編集、チェックで+1 XP（1日5回まで）。削除は「元に戻す」ができます。朝のブリーフィングが今日の期日を教えてくれます。

• 読めるレリック。すべてのレリックにEからSのランク文字が付き、強さが一目で分かります。NEWは本当に新しいものだけ。見れば消えます。レアリティごとに色はひとつ、どの画面でも同じです。

• より公平なドロップ。Eランクのゲートは気前よく、ランクが上がるほど少しずつ渋くなります。レアと超レアの救済がAとSを含むすべてのボスに適用されます。24のレリックを再調整し、上のランクが下のランクより弱いことはなくなりました。

• コミュニティボード。自分の投稿を編集でき、対処済みの報告には「解決済み」が表示されます。
```

### Norwegian (Bokmål)

```
Dagen i tre deler. Og løse tråder.

• Løftene dine leses nå som en dag. Vaner-fanen samler dem i MORGEN, DAG og KVELD, hver med sin telling. Den delen av dagen du er i, lyser. Fullfør alle løftene i en del, og den folder seg sammen av seg selv så resten kommer til syne.

• Legg hvert løfte der det hører hjemme. Dra det i håndtaket for å endre rekkefølgen, eller flytt det til en annen del av dagen. Nye og redigerte løfter får et valg for TID PÅ DAGEN.

• Gjøremål. Engangsoppgaver bor nå ved siden av løftene dine, samlet etter dag: FORFALT, I DAG, I MORGEN, SENERE, EN DAG. Gi dem en frist, en påminnelse og et notat; merk dem PRIORITET så de går først. Sveip til venstre for å utsette eller slette, trykk på teksten for å redigere, kryss av for +1 XP (fem om dagen). Sletting kan angres. Morgenbriefen forteller deg hva som forfaller i dag.

• Relikvier du kan lese. Hver relikvie bærer rangbokstaven sin, E til S, så styrken er åpenbar med ett blikk. NY betyr ny: den forsvinner når du har sett på den. Én farge per sjeldenhet, overalt.

• Rettferdigere drops. Porter av rang E er rause; hver rang opp gir litt mindre. Beskyttelsen for sjeldne og ultrasjeldne dekker nå alle bosser, også A og S. Tjuefire relikvier ble balansert på nytt, så en høyere rang aldri er svakere enn en lavere.

• Fellesskapstavlen. Rediger et innlegg du skrev, og se LØST på rapporter som er håndtert.
```

### Promotional text (170 max; can change any time without review)

- **English (149):** Your vows now read like a day: morning, day, evening. Add to-dos beside them, drag anything where it belongs, and see every relic's rank at a glance.
- **Spanish (160):** Tus votos ahora se leen como un día: mañana, día y noche. Añade pendientes a su lado, arrastra cada uno a su sitio y ve el rango de cada reliquia de un vistazo.
- **Japanese (63):** 誓いが一日の流れで読めるように：朝・昼・夜。隣にやることを追加し、ドラッグで好きな場所へ。レリックのランクも一目で分かります。
- **Norwegian (152):** Løftene dine leses nå som en dag: morgen, dag, kveld. Legg gjøremål ved siden av, dra alt dit det hører hjemme, og se hver relikvies rang med ett blikk.

## 3.0.7 — READY TO PASTE (W968–W986, final 2026-09-23, build 542)

Four languages. Each block is under the 4,000-character limit. Banned-word check
done (no "fell"/"felled" in any language). Apple Health uses Apple's own name for
the app in each language (Salud / ヘルスケア / Helse).

### English (U.S.)

```
Your vows are yours. Your glory is verified.

• A new morning briefing. Every day opens with your vows, your streak and the XP on the table — hold to begin. It also tells you how the Worldgate stands and when there's news from the developers.

• Hunt results with real weight. Solo and co-op, win or lose: the kill, every hunter's share, the MVP, your souls and relics — or exactly how close you came.

• Tick every vow yourself. Daily walk, Sleep and Workout are ordinary vows now — tap them when you've kept them.

• Apple Health still powers the hunt. Your real steps, sleep and workouts bring bosses down, strike the Worldgate and set every leaderboard. What other hunters see stays verified.

• Make as many vows as you like. The five-vow limit is gone. Every vow you create is worth +1 XP, up to 25 in all.

• A new Worldgate every Sunday. Each world boss is sized to last the whole week. The top three hunters wear MVP, 2ND and 3RD — and when the gate goes down, they take the podium and earn bonus souls.

• Updates on the Community board. News from the developers gets its own section, pinned each week.

• A Morning Routine you can finish. New hunters get six steps that fit inside the first hour.
```

### Spanish (Mexico)

```
Tus votos son tuyos. Tu gloria, verificada.

• Un nuevo resumen matutino. Cada día empieza con tus votos, tu racha y la XP en juego — mantén presionado para comenzar. También te dice cómo va la Worldgate y cuándo hay noticias de los desarrolladores.

• Resultados de cacería con peso real. En solitario o en cooperativo, ganes o pierdas: la victoria, la parte de cada cazador, el MVP, tus almas y reliquias — o exactamente qué tan cerca estuviste.

• Marca cada voto tú mismo. Caminata diaria, Sueño y Entrenamiento ahora son votos normales — tócalos cuando los hayas cumplido.

• La app Salud sigue impulsando la cacería. Tus pasos, tu sueño y tus entrenamientos reales derrotan jefes, golpean la Worldgate y definen cada clasificación. Lo que ven los demás cazadores sigue verificado.

• Crea todos los votos que quieras. Se acabó el límite de cinco. Cada voto que crees vale +1 XP, hasta 25 en total.

• Una nueva Worldgate cada domingo. Cada jefe mundial está hecho para durar toda la semana. Los tres mejores cazadores llevan MVP, 2.º y 3.º — y cuando cae la puerta, suben al podio y ganan almas extra.

• Novedades en el tablero de la Comunidad. Las noticias de los desarrolladores tienen su propia sección, fijada cada semana.

• Una Rutina Matutina que sí puedes terminar. Los cazadores nuevos reciben seis pasos que caben en la primera hora.
```

### Japanese

```
誓いはあなたのもの。栄光は、検証されたものだけ。

• 新しい朝のブリーフィング。毎日、今日の誓い・連続記録・獲得できるXPから始まります。長押しでスタート。Worldgateの状況や、開発者からのお知らせもここで確認できます。

• 手応えのあるハント結果。ソロでも協力プレイでも、勝っても負けても——撃破の瞬間、ハンターごとの貢献、MVP、獲得したソウルとレリック。届かなかったときは、あとどれだけだったかも。

• 誓いは自分でチェック。「毎日のウォーキング」「睡眠」「ワークアウト」も通常の誓いになりました。守ったらタップするだけです。

• ハントの力は引き続きヘルスケアから。実際の歩数・睡眠・ワークアウトがボスを倒し、Worldgateに一撃を与え、すべてのランキングを決めます。ほかのハンターに見える記録は、これまでどおり検証済みです。

• 誓いは好きなだけ。5つまでの上限はなくなりました。作成した誓いはそれぞれ+1 XP、合計25個まで。

• 毎週日曜日、新しいWorldgateが出現。ワールドボスは一週間かけて挑む強さに。上位3人のハンターにはMVP・2ND・3RDの称号がつき、ゲートを倒すと表彰台に立ってボーナスソウルを獲得します。

• コミュニティ掲示板に「アップデート」。開発者からのお知らせ専用のセクションが、毎週トップに固定されます。

• やり切れるモーニングルーティン。新しいハンターには、最初の1時間に収まる6つのステップを用意しました。
```

### Norwegian (Bokmål)

```
Løftene dine er dine. Æren din er verifisert.

• En ny morgenbriefing. Hver dag starter med løftene dine, rekken din og XP-en som står på spill — hold inne for å begynne. Den forteller deg også hvordan det står til med Worldgate, og når utviklerne har nyheter.

• Jaktresultater med ekte tyngde. Alene eller sammen, seier eller tap: drapet, hver jegers andel, MVP-en, sjelene og relikviene dine — eller nøyaktig hvor nær du var.

• Kryss av hvert løfte selv. Daglig gåtur, Søvn og Trening er vanlige løfter nå — trykk på dem når du har holdt dem.

• Helse-appen driver fortsatt jakten. Dine ekte skritt, søvn og treningsøkter tar ned bosser, slår mot Worldgate og avgjør hver toppliste. Det andre jegere ser, er fortsatt verifisert.

• Lag så mange løfter du vil. Grensen på fem er borte. Hvert løfte du lager er verdt +1 XP, opptil 25 totalt.

• En ny Worldgate hver søndag. Hver verdensboss er laget for å vare hele uken. De tre beste jegerne bærer MVP, 2ND og 3RD — og når porten går ned, tar de pallen og får bonussjeler.

• Oppdateringer på fellesskapstavlen. Nyheter fra utviklerne får sin egen seksjon, festet øverst hver uke.

• En morgenrutine du faktisk kan fullføre. Nye jegere får seks steg som passer inn i den første timen.
```

### Promotional text (170 max; can change any time without review)

- **English (160):** A new Worldgate rises every Sunday. Walk, sleep and train to bring it down with every hunter, then wake to a briefing that turns your vows into the day’s quest.
- **Spanish (159):** Cada domingo surge una nueva Worldgate. Camina, duerme y entrena para derribarla con todos los cazadores, y empieza el día con tus votos convertidos en misión.
- **Japanese (78):** 毎週日曜日、新しいWorldgateが出現。歩いて、眠って、鍛えて、すべてのハンターと一緒に倒そう。毎朝のブリーフィングが、今日の誓いをクエストに変えます。
- **Norwegian (149):** Hver søndag reiser en ny Worldgate seg. Gå, sov og tren for å ta den ned sammen med alle jegerne, og start dagen med løftene dine som dagens oppdrag.

Deliberately left out: the review cards (never advertise a rating ask), the
developer crown, the preview rows (owner/mod tools), and the strike freeze
(a fairness fix, not a feature).

## ⚠ 3.0.6 — READY TO PASTE (W967, drafted 2026-09-20)

Three parts: the release notes, and **three corrections to the live description**. The
corrections matter more than the notes — two of them describe features the shipping build
does not have, which is what Guideline 2.3.1 is about.

### Release notes (What's New)

```
The ladder you climb, where you can see it.

• Your rank moves when you do. The bar under your rank card fills toward
  your next division and flashes every time you seal a vow. It was always
  being counted — the header was hiding it.

• A division is a moment now. A letter is three marks. Crossing D III to
  D II lights one of them, and the screen tells you how many are left
  before the next letter.

• The gate falls like it matters. When the world boss goes down, the
  screen names the monster, how many hunters brought it down, and how many
  of your own steps landed on it.

• The Worldgate stops escalating. It no longer grows after a win — next
  week's gate is the same size as this week's.

Also fixed: Manage Vows was opening below the fold and read as a dead
button.
```

### Correction 1 — Ranked PvP (REQUIRED)

The live description carries this as a headline bullet:

> Ranked PvP — The Arena — Live turn-based duels, a seasonal rating ladder, and spar a
> friend's Echo anytime.

**None of it is reachable.** `PVP_RANKED_LOCKED = true` (app.js:16902) seals the ranked queue
**and** the friend Echo — both route to `_pvpLockedNudge()`, a card reading *"The Arena Is
Sealed — ranked duels open once enough rivals have awakened."* A reviewer following the
description gets that card. Replace the bullet with something true and already shipped:

```
One world boss, all of us — Every hunter's verified steps strike the same weekly Worldgate.
Bring it down together, and the hunters who landed enough steps share the bounty.
```

Put the PvP bullet back when `PVP_RANKED_LOCKED` flips to false.

### Correction 2 — Streak Shields (REQUIRED)

> Streaks with stakes — Keep your daily vows, build streaks, and earn Streak Shields and soul
> rewards.

Streak Shields were **deleted in W918** (owner, 2026-09-06). Replace with:

```
Streaks with stakes — Keep your daily vows and hold your streak. The system remembers every
one, and pays souls for the discipline.
```

### Correction 3 — the five-hunter raid (worth a word)

> Hunt bosses solo or co-op — Take down dungeon bosses on your own, or summon up to four
> allies for a five-hunter raid.

The five-hunter raid (the Grinning God) is `membersOnly: true` and gated on `isMember`
(app.js:57694). Softer than the other two — it exists, it is just paid — but the sentence
reads as included. One word fixes it:

```
… or summon up to four allies for a five-hunter raid (Premium).
```

### Also outstanding, not metadata
- ASC **review notes** reportedly still say membership has "no gameplay effect". Verify.
- Download size is **344 MB**, nearly all relic/boss art at print weight.
- The privacy-policy URL on the listing is a default Netlify subdomain.

---

## Current — live as of 2.2.5 (W185 / `bcac999`)

| Field | Value |
|---|---|
| **App name** | Awakened: Habit RPG |
| **Subtitle** | _[fill in from App Store Connect — current live value]_ |
| **Primary category** | Health & Fitness |
| **Secondary category** | Lifestyle |
| **App Store URL** | https://apps.apple.com/app/awakened-habit-rpg/id6764727990 |
| **App ID** | 6764727990 |
| **Bundle ID** | com.goallearner.awakened (verify on Mac) |
| **Submission ID (2.2.5)** | 6175efed-0d8c-4caa-891e-f609ed440c5a |
| **Approval date** | 2026-06-05 |

### Current subtitle

_[paste the exact 30-char subtitle from App Store Connect here]_

### Current description (live)

_[paste the live description from App Store Connect — copy from the
listing page, preserve formatting]_

### Current keywords (100-char limit)

_[paste current comma-separated keyword list]_

### Promotional text (170 chars)

_[paste current promotional text]_

### What's new in 2.2.5

> Hunter — the system grows sharper.
>
> • Meet The First Awakened — your guide through the early gates of the system
> • Eight new hunter class portraits, redrawn in full
> • Manage Vows — release vows you no longer keep without losing your streak history
> • A top 10 finish on the Steps leaderboard now posts to your Guild feed
> • Global Rankings refined — Steps is the singular proving ground
> • New app mark, sharper
>
> Keep what you swore.

---

## ✅ READY TO PASTE — ASO copy (W327, drafted 2026-06-15)

Paste into App Store Connect. Name + Subtitle + Keywords are the INDEXED
fields — do NOT repeat name/subtitle words in Keywords (wasted space).
No new build is required for metadata-only updates.

### Subtitle (30 max) — RECOMMENDED
`A habit RPG for real growth` (27 chars)

> Names the category for ASO relevance and adds a benefit ("growth").
> A/B alternative: `Real habits. RPG rewards.` (25) — punchier, test later.

### Keywords (100 max — comma-separated, NO spaces)

```
tracker,streak,routine,discipline,motivation,goals,fitness,workout,steps,sleep,quest,boss,level,rank
```

> Exactly 100/100. Excludes words Apple already indexes from the name
> ("awakened","habit","rpg") and subtitle ("growth"). Singular forms only
> (Apple matches plural automatically).

### Promotional text (170 max)

> Turn your habits into an RPG. Complete real vows — verified by Apple Health — to earn XP, rank up your hunter, and slay bosses with pure discipline. The grind, witnessed.

### Description (4,000 max)

```
AWAKENED — TURN YOUR HABITS INTO AN RPG

You already know what to do. Awakened makes you want to do it.

Every habit you keep in real life levels up a hunter inside the game. Walk your steps, sleep enough, finish a workout — Apple Health verifies it, and you earn XP, grow your stats, and climb from E-rank to Sovereign. No fake check-ins. No logging you can game. Only real discipline counts.

HOW IT WORKS
• Set your vows (your habits). Keep them daily.
• Apple Health verifies steps, sleep, workouts and more — automatically.
• Earn XP, level up, and rank up your hunter.
• Build streaks. The system remembers every one.

FIGHT BOSSES WITH REAL DISCIPLINE
Each boss falls only when you hit a real-world goal — 10,000 verified steps, a logged strength workout, a flight of stairs. Slay it, claim relics and souls, grow stronger.

CLIMB THE ASCENT
100 floors, each harder than the last. The summit — The First Awakened — is the endgame. Only a fully-built hunter reaches it.

COMPETE & SHARE
• Weekly Steps leaderboard, reset every Sunday — race real hunters and your friends.
• "Hunters in your rank" — a board you can actually win.
• Share your boss kills and your Hunter Report card straight to your story.

FREE AND FAIR
The core — habits, bosses, the Ascent, the leaderboard — is free and stays fair forever. Nothing is pay-to-win. Cosmetics only.

The system is watching. Keep what you swore.
```

### What’s new — next version (match to the shipped build before pasting)

> Hunter — the system reaches further.
>
> • Share your boss kills and Hunter Report as a card — straight to your story
> • New boards: Hunters in your rank, and a Friends leaderboard
> • The weekly Steps board now shows a live "resets Sunday" countdown
> • Become a Founder — back Awakened once, keep it forever
>
> Keep what you swore.

---

## W189 candidates (pending decision)

### Subtitle — ClaudeDesign + W189-Prep recommendation

**Control: `A habit RPG for real growth.`** (28 chars)

Rationale:
- Names the category ("habit RPG") — strong for ASO keyword relevance
- Adds a benefit ("real growth") — pairs with the headline rather than echoing it
- Plain enough for cold App Store browsers
- 28 chars leaves 2-char headroom

**A/B variant: `Real habits. RPG rewards.`** (25 chars)

- Punchiest of the four candidates
- Better for casual / impatient browsers
- Test against Control after baseline data

### Screenshot sequence (6.9" set, iPhone 16 Pro Max baseline)

| # | Kicker | Headline | Capture target |
|---|---|---|---|
| 01 | A HABIT RPG | Turn your habits into an **RPG**. | Status / Home — rank tile + hunter portrait + World Rank + souls |
| 02 | THE DAILY LOOP | Complete vows. Earn **XP**. | Habits tab — mixed sealed/unsealed vows + Apple Health verify chip on one |
| 03 | WITNESSED | Rank up your hunter. | Hunter Report W187 preview OR First Awakened rank-up modal |
| 04 | THE HUNT | Fight bosses with real **discipline**. | Boss / Quests — engageable boss with condition text |
| 05 | YOUR BUILD | Grow your stats. Earn **relics**. | Stats + Armory — stat levels + relic detail |
| 06 | TOGETHER | Climb the ranks with your **guild**. | Social / Guild + Steps leaderboard (W181 sim rows acceptable) |

Logic per ClaudeDesign: shots 1–3 must stand alone for browsers who only see the first three. That trio = **promise → action → differentiator**.

### Future what's new entries

When 2.2.6 ships, the entry should highlight:

- Day 3 / Day 7 / streak-loss First Awakened check-ins (W186)
- Hunter Report shareable card (W187 / W188)

Draft for 2.2.6:

> Hunter — every climb is now witnessed.
>
> • Day 3 / Day 7 check-ins from The First Awakened
> • Streak-loss recovery moment — the discipline does not break with the streak
> • Hunter Report — a shareable artifact of your rank-up moment
>
> Bear the mark.

(refine on actual ship)

---

## Notes on Apple's character limits

| Field | Limit |
|---|---|
| Subtitle | 30 chars |
| Promotional text | 170 chars |
| Description | 4,000 chars |
| Keywords | 100 chars (comma-separated, no spaces between) |
| What's new | 4,000 chars |
| Screenshot caption (in image) | unlimited but readable at 60×60 thumbnail matters |

## Apple-spec dimensions per device class (2024+)

| Device class | Required for new submissions | Dimensions |
|---|---|---|
| iPhone 6.9" | ✓ **Required baseline** | 1320 × 2868 |
| iPhone 6.7" | Derived from 6.9" | 1290 × 2796 |
| iPhone 6.5" | Optional after 6.9" | 1284 × 2778 |
| iPad 13" | Optional | 2064 × 2752 |
| iPad 12.9" | Derived | 2048 × 2732 |

Capture once at 6.9", let Apple derive the smaller iPhone sizes.

---

## 2.2.7 — SUBMITTED COPY (drafted 2026-06-17, paste-ready)

⚠️ The previously-live description opened with "Solo Leveling inspired" — protected
IP, an App Review 2.3.1 risk. This copy REMOVES it. Replace the live description.

### Promotional text (170 max)
> Turn your habits into an RPG. Real vows, verified by Apple Health, earn XP — rank up your hunter and fell bosses with pure discipline. The grind, witnessed.

### Description (4,000 max)
```
AWAKENED — TURN YOUR HABITS INTO AN RPG

You already know what to do. Awakened makes you want to do it.

Every habit you keep in real life levels up a hunter inside the game. Walk your steps, sleep enough, finish a workout — Apple Health verifies it, and you earn XP, grow your stats, and climb from E-rank to Sovereign. No fake check-ins. No logging you can game. Only real discipline counts.

HOW IT WORKS
• Set your vows — your real habits. Keep them daily.
• Apple Health verifies steps, sleep, workouts and more, automatically.
• Earn XP, level up your stats, and rank up your hunter.
• Build streaks. The system remembers every one.

FIGHT BOSSES WITH REAL DISCIPLINE
Each boss falls only when you hit a real-world goal — 10,000 verified steps, a logged workout, a flight of stairs. Slay it, claim relics and souls, grow stronger.

CLIMB THE ASCENT
One hundred floors, each harder than the last. The summit — the First Awakened — is the endgame. Only a fully built hunter reaches it.

HUNT TOGETHER
Summon a friend and bring down a co-op boss together. Walk your steps side by side, and when the beast falls, you're both credited.

COMPETE & SHARE
• A weekly Steps leaderboard that resets every Sunday — climb against real hunters and your friends.
• Hunters in your rank — a board you can actually win.
• Share your boss kills and your Hunter Report card straight to your story.

FREE AND FAIR
The core — habits, bosses, the Ascent, the leaderboard, co-op — is free and stays fair. Nothing is pay-to-win. Cosmetics only.

The system is watching. Keep what you swore.
```

### What's new in 2.2.7 (4,000 max)
```
Hunter — the system opens to allies.

CO-OP HUNTS
Summon a friend and bring down The Twin Maw together — combine your steps, share the kill, both of you credited. When an ally calls you in, the summons arrives as a full cinematic.

A SHARPER ARENA
• The global Steps leaderboard, redesigned — cleaner, with your rank pinned in view.
• New prestige marks beside your name: the 100K Step Club seal and the 100-boss-kills stamp.
• Leave an active co-op hunt any time, with no penalty.

Plus polish and fixes throughout.

Keep what you swore.
```
