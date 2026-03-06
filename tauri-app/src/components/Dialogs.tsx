import { ReactNode } from "react";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";

interface ConfirmDialog {
  open: boolean;
  title: string;
  message?: string;
  content?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface DialogsProps {
  showHowTo: boolean;
  onCloseHowTo: () => void;
  showAbout: boolean;
  onCloseAbout: () => void;
  confirm?: ConfirmDialog | null;
}

export function Dialogs({ showHowTo, onCloseHowTo, showAbout, onCloseAbout, confirm }: DialogsProps) {
  return (
    <>
      <Dialog
        open={showHowTo}
        onClose={onCloseHowTo}
        title="How to Use Apple Music History Converter"
        width="lg"
      >
        <div className="space-y-4 text-sm">
          <section>
            <h3 className="font-semibold mb-2">Step 1: Export Your Apple Music History</h3>
            <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
              <li>Open Apple Music app on iPhone/iPad</li>
              <li>Go to Settings → Privacy → Request Your Data</li>
              <li>Wait for email with download link (1-2 weeks)</li>
              <li>Extract ZIP and find "Apple Music Play Activity.csv"</li>
            </ol>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Step 2: Load CSV File</h3>
            <p className="text-muted-foreground">Click "Select CSV File" button and choose your exported CSV.</p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Step 3: Choose Search Provider</h3>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li><strong>MusicBrainz API</strong> - Free, fast, no rate limits (recommended)</li>
              <li><strong>iTunes API</strong> - Fallback option, 20 requests/minute limit</li>
              <li><strong>Apple Music API</strong> - Requires credentials, ISRC support</li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Step 4: Start Search</h3>
            <p className="text-muted-foreground">Click "Search" and wait for the app to match your tracks. You can pause/resume or stop anytime.</p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Step 5: Export Results</h3>
            <p className="text-muted-foreground">Choose your export format:</p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li><strong>Last.fm CSV</strong> - For Last.fm scrobbler import</li>
              <li><strong>ListenBrainz JSON</strong> - For ListenBrainz.org</li>
              <li><strong>Spotify CSV</strong> - For third-party Spotify importers</li>
              <li><strong>Universal CSV</strong> - All original fields preserved</li>
            </ul>
          </section>
        </div>
      </Dialog>

      <Dialog
        open={showAbout}
        onClose={onCloseAbout}
        title="About Apple Music History Converter"
        width="md"
      >
        <div className="text-sm space-y-4">
          <div>
            <div className="text-lg font-semibold">Apple Music History Converter</div>
            <div className="text-muted-foreground">Version 3.0.0</div>
          </div>

          <div>
            <div className="font-medium mb-1">Description</div>
            <p className="text-muted-foreground">
              Convert Apple Music play history CSV files into Last.fm, ListenBrainz, and other compatible formats.
              Supports MusicBrainz, iTunes, and Apple Music API for track matching.
            </p>
          </div>

          <div>
            <div className="font-medium mb-1">Technology Stack</div>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              <li>Frontend: React + TypeScript + TailwindCSS</li>
              <li>Backend: Rust (Tauri) + Python sidecar</li>
              <li>Database: DuckDB for MusicBrainz offline search</li>
              <li>APIs: MusicBrainz, iTunes, Apple Music</li>
            </ul>
          </div>

          <div>
            <div className="font-medium mb-1">Credits</div>
            <p className="text-muted-foreground">
              Developed by Ashraf Ali
            </p>
          </div>

          <div>
            <div className="font-medium mb-1">Links</div>
            <div className="space-y-1">
              <a href="https://github.com/nerveband/Apple-Music-Play-History-Converter" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline block">
                GitHub Repository
              </a>
              <a href="https://github.com/nerveband/Apple-Music-Play-History-Converter/issues" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline block">
                Report Issues
              </a>
            </div>
          </div>

          <div className="text-xs text-muted-foreground pt-2 border-t border-border">
            MIT License - Open Source Software
          </div>
        </div>
      </Dialog>

      {confirm && (
        <Dialog
          open={confirm.open}
          onClose={confirm.onCancel}
          title={confirm.title}
          footer={
            <>
              <Button variant="ghost" onClick={confirm.onCancel}>{confirm.cancelLabel ?? "Cancel"}</Button>
              <Button onClick={confirm.onConfirm}>{confirm.confirmLabel ?? "Confirm"}</Button>
            </>
          }
        >
          {confirm.content ?? <div className="text-sm">{confirm.message}</div>}
        </Dialog>
      )}
    </>
  );
}
