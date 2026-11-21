# WILD SURVIVAL – eigener Spielserver

Dieser Ordner ist ein kompletter Spielserver. Er liefert das Spiel aus, und alle, die deinen Link öffnen, spielen zusammen. Dafür braucht niemand ein Konto.

- Das Spiel läuft unter `/`, der Multiplayer über WebSocket unter `/ws`.
- **Dedizierte Welten:** Der Server ist der Host jeder Welt. Er speichert Welt-Seed, Uhrzeit, Wetter, Gebäude, geöffnete Truhen und die Geheimtür in `data/worlds.json`. Welten laufen weiter, auch wenn gerade niemand online ist.
- **Im Spiel:** MULTIPLAYER → „Server erstellen“ legt eine neue Welt mit Code an (z. B. `palme-1234`). Freunde finden sie unter „Offene Server“ oder geben den Code ein.
- **Status-Seite:** `/api/status` zeigt, wie viele Welten und Spieler gerade da sind.

---

## A) Kostenlos online stellen mit Render (geht auch vom iPad)

Du brauchst zwei kostenlose Konten: **GitHub** (github.com) und **Render** (render.com).

### 1. Dateien zu GitHub hochladen
1. Entpacke die ZIP-Datei in der **Dateien**-App: ZIP antippen, dann entsteht ein Ordner.
2. Melde dich in Safari auf **github.com** an und tippe auf **„+“ → „New repository“**.
3. Gib als Name `wild-survival` ein, wähle **Public** oder **Private** und tippe auf **Create repository**.
4. Tippe auf **„uploading an existing file“**. Wähle **alle Dateien aus dem entpackten Ordner** aus: `server.js`, `package.json`, `render.yaml`, `README.md`, `.gitignore` und den Ordner `public` mit `index.html` darin.
   - Wenn sich der Ordner `public` nicht hochladen lässt: Lade erst die anderen Dateien hoch. Tippe dann auf **Add file → Create new file**, tippe als Namen `public/index.html` ein und füge dort den Inhalt von `index.html` ein. Einfacher geht es am Computer.
5. Tippe auf **Commit changes**.

### 2. Server bei Render starten
1. Melde dich auf **render.com** mit deinem GitHub-Konto an.
2. Tippe auf **New → Web Service** und wähle dein Repository `wild-survival` aus.
3. Render liest die Einstellungen aus `render.yaml`. Falls nicht, trage selbst ein:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Tippe auf **Create Web Service**. Nach 1–3 Minuten steht da **„Live“**.
5. Oben steht deine Adresse, z. B. `https://wild-survival.onrender.com`. **Das ist dein Spiel-Link zum Teilen.**

### Gut zu wissen beim kostenlosen Render-Tarif
- **Schlafmodus:** Nach 15 Minuten ohne Besucher schläft der Server ein. Der nächste Aufruf dauert dann etwa eine Minute, danach läuft alles normal.
- **Keine dauerhafte Speicherung:** Welten bleiben erhalten, solange der Server läuft. Bei einem Neustart oder Update können sie verloren gehen, weil der kostenlose Tarif keine feste Festplatte hat.
  - Für dauerhafte Welten brauchst du einen bezahlten Tarif mit **Disk**: In Render unter *Disks* eine Disk mit Pfad `/var/data` anlegen und die Umgebungsvariable `DATA_DIR=/var/data` setzen.
- **Spielstände der Spieler:** Inventar und Level jedes Spielers speichert dessen eigener Browser.

---

## B) Auf dem eigenen Computer starten (zum Testen)

Du brauchst **Node.js 18 oder neuer** (nodejs.org).

```bash
npm install
npm start
```

Danach öffnest du `http://localhost:3000`. Andere Geräte im selben WLAN erreichen das Spiel über `http://<IP-deines-Computers>:3000`.

---

## Einstellungen (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | 3000 | Port des Servers (Render setzt ihn automatisch) |
| `DATA_DIR` | `./data` | Ordner, in dem die Welten gespeichert werden |
| `MAX_WORLDS` | 300 | Höchstzahl gespeicherter Welten (alte, leere Welten werden ersetzt) |
| `MAX_PLAYERS` | 16 | Höchstzahl gleichzeitiger Spieler pro Welt |

## Was synchronisiert wird
- **Für alle gleich:** Spieler mit Namen, Aussehen, Werkzeug und Bewegungen, gefällte Bäume und abgebaute Rohstoffe, Gebäude und Türen, geöffnete Truhen, die Geheimtür, Uhrzeit und Wetter, Chat und das Geben von Gegenständen.
- **Pro Spieler:** Inventar, Level, Quests, Felder und Lagerkisten.
- **Nicht synchron:** Tiere bewegen sich auf jedem Gerät für sich.

## Sicherheit
- **Grenzen:** Der Server begrenzt Nachrichtenrate, Nachrichtengröße, Spieler pro Welt und Gebäude pro Welt.
- **Gebäude:** Er speichert nur Gebäude mit gültigen Werten.
- **Kein Konto:** Es gibt keine Anmeldung. Jeder mit dem Link kann mitspielen und bauen. Gib den Link also nur weiter, wenn das für dich in Ordnung ist.
