# sparpreis.guru

Such dir die billigsten Bahntickets über einen gewissen Zeitraum. Wenn du zeitlich flexibel bist, kannst du mit dieser App den günstigsten Preis für deine Fahrt über mehrere Tage oder sogar Wochen hinweg finden.

**Features:**

- Zeitraum wählen (z.B. nächste 4 Wochen) + bestimmte Wochentage filtern
- Abfahrts-/Ankunftszeiten eingrenzen
- BahnCard 25/50, Klasse, Max. Umstiege, Direktverbindungen
- Kalenderansicht mit günstigsten Tagen auf einen Blick
- Klick auf Tag → alle Verbindungen des Tages
- Streaming-Suche mit Echtzeit-Updates
- Anzeige der Preis-Historie, sofern für eine Verbindung bereits Preisdaten vorhanden sind

## Installation

**Mit Node.js:**

```bash
git clone https://github.com/XLixl4snSU/sparpreis.guru.git
cd sparpreis.guru
pnpm install
pnpm dev
```

Dann auf http://localhost:3000

**Mit Docker:**

```bash
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_BASE_URL="http://localhost:3000" \
  -v path/to/local/data:/app/data \
  ghcr.io/xlixl4snsu/sparpreis-guru:latest
```

> **Hinweis:**  
> Für einen konsistenten Cache und damit die Preis-Historie und Suchergebnisse erhalten bleiben, sollte das Verzeichnis `/app/data` im Container als Volume gemountet werden. Dort liegt die SQLite-Datenbank.  
> Ohne Volume ist die Datenbank nach jedem Update oder Neustart des Containers leer.

## Deployment

Funktioniert auf Vercel, Railway, oder wo auch immer Next.js läuft.

Einzige Umgebungsvariable die du brauchst:

- `NEXT_PUBLIC_BASE_URL` – Deine Domain (z.B. `https://sparpreis.guru`)

## Monitoring (optional)

Falls du Prometheus/Grafana nutzt, kannst du Metriken unter `/api/metrics` abrufen:

```bash
# Mit API-Key schützen
METRICS_API_KEY=geheim123

# Optional: Nur bestimmte IPs erlauben
ALLOWED_METRICS_IPS=127.0.0.1,10.0.0.0/8
```

Prometheus Config:

```yaml
scrape_configs:
  - job_name: sparpreis
    metrics_path: /api/metrics
    static_configs:
      - targets: ["localhost:3000"]
    authorization:
      credentials: geheim123
```

## Techstack

- Next.js 15 (App Router)
- TypeScript
- Tailwind + shadcn/ui
- Streaming APIs mit Server-Sent Events
- Rate Limiting & Caching

## Credits

Basiert auf [bahn.vibe](https://github.com/jschae23/bahn.vibe), ursprünglich inspiriert von einer PHP-Version von hackgrid.

## Lizenz

GPLv3