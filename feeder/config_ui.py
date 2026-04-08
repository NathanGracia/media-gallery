"""
Interface de configuration au premier lancement (Tkinter).
Retourne le dict config ou None si annulé.
"""
import socket
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from typing import Optional

import requests


def show_config_ui() -> Optional[dict]:
    result = {}

    # ── Window ────────────────────────────────────────────────────────────────
    root = tk.Tk()
    root.title("MediaFeeder v3 — Configuration")
    root.resizable(False, False)
    root.configure(bg="#14141c")

    # Center window
    root.update_idletasks()
    w, h = 480, 500
    x = (root.winfo_screenwidth()  - w) // 2
    y = (root.winfo_screenheight() - h) // 2
    root.geometry(f"{w}x{h}+{x}+{y}")
    root.minsize(480, 500)

    # ── Styles ────────────────────────────────────────────────────────────────
    BG      = "#14141c"
    SURFACE = "#1e1e2a"
    BORDER  = "#2a2a3a"
    ACCENT  = "#7b6bff"
    TEXT    = "#e2e2ec"
    DIM     = "#7878a0"

    style = ttk.Style()
    style.theme_use("clam")
    style.configure(".",
        background=BG, foreground=TEXT,
        font=("Segoe UI", 10),
        fieldbackground=SURFACE,
        bordercolor=BORDER,
        troughcolor=SURFACE,
    )
    style.configure("TEntry",
        fieldbackground=SURFACE, foreground=TEXT,
        insertcolor=TEXT, relief="flat",
        padding=6,
    )
    style.configure("TButton",
        background=ACCENT, foreground="#ffffff",
        relief="flat", padding=(10, 6),
        font=("Segoe UI", 10, "bold"),
    )
    style.map("TButton",
        background=[("active", "#9b8bff"), ("pressed", "#5b4bdf")],
    )
    style.configure("Ghost.TButton",
        background=SURFACE, foreground=DIM,
        relief="flat", padding=(8, 5),
        font=("Segoe UI", 9),
    )
    style.map("Ghost.TButton",
        background=[("active", BORDER)],
    )
    style.configure("TLabel",
        background=BG, foreground=DIM,
        font=("Segoe UI", 9),
    )
    style.configure("Title.TLabel",
        background=BG, foreground=TEXT,
        font=("Segoe UI", 14, "bold"),
    )
    style.configure("Sub.TLabel",
        background=BG, foreground=DIM,
        font=("Segoe UI", 9),
    )
    style.configure("Field.TLabel",
        background=BG, foreground=TEXT,
        font=("Segoe UI", 9, "bold"),
    )
    style.configure("Status.TLabel",
        background=BG, font=("Segoe UI", 8),
    )

    # ── Header ────────────────────────────────────────────────────────────────
    header = tk.Frame(root, bg="#0f0f13", pady=18)
    header.pack(fill="x")
    tk.Label(header, text="◈  MediaFeeder v3", bg="#0f0f13",
             fg=TEXT, font=("Segoe UI", 15, "bold")).pack()
    tk.Label(header, text="Configuration initiale", bg="#0f0f13",
             fg=DIM, font=("Segoe UI", 9)).pack(pady=(2, 0))

    # ── Form ──────────────────────────────────────────────────────────────────
    form = tk.Frame(root, bg=BG, padx=30, pady=20)
    form.pack(fill="both", expand=True)

    def field(parent, label, default="", show=None, row=0):
        tk.Label(parent, text=label, bg=BG, fg=TEXT,
                 font=("Segoe UI", 9, "bold")).grid(
            row=row * 2, column=0, sticky="w", pady=(12, 2))
        var = tk.StringVar(value=default)
        kw = {"textvariable": var, "width": 44, "font": ("Segoe UI", 10)}
        if show:
            kw["show"] = show
        e = tk.Entry(parent, **kw,
                     bg=SURFACE, fg=TEXT, relief="flat",
                     insertbackground=TEXT,
                     highlightthickness=1, highlightcolor=ACCENT,
                     highlightbackground=BORDER)
        e.grid(row=row * 2 + 1, column=0, sticky="ew", ipady=5)
        return var, e

    form.columnconfigure(0, weight=1)

    var_url,    e_url    = field(form, "URL du serveur galerie",
                                 "http://VOTRE_IP:8000", row=0)
    var_key,    e_key    = field(form, "Clé API",
                                 "REMPLACE_MOI_AVEC_UNE_CLE_SECRETE", show="•", row=1)
    var_name,   e_name   = field(form, "Nom de ce feeder",
                                 socket.gethostname(), row=2)

    # Folder picker
    tk.Label(form, text="Dossier à surveiller", bg=BG, fg=TEXT,
             font=("Segoe UI", 9, "bold")).grid(
        row=6, column=0, sticky="w", pady=(12, 2))

    folder_frame = tk.Frame(form, bg=BG)
    folder_frame.grid(row=7, column=0, sticky="ew")
    folder_frame.columnconfigure(0, weight=1)

    var_folder = tk.StringVar()
    e_folder = tk.Entry(folder_frame, textvariable=var_folder,
                        font=("Segoe UI", 10),
                        bg=SURFACE, fg=TEXT, relief="flat",
                        insertbackground=TEXT,
                        highlightthickness=1, highlightcolor=ACCENT,
                        highlightbackground=BORDER)
    e_folder.grid(row=0, column=0, sticky="ew", ipady=5)

    def browse():
        path = filedialog.askdirectory(title="Choisir le dossier à surveiller")
        if path:
            var_folder.set(path)

    tk.Button(folder_frame, text="...", command=browse,
              bg=SURFACE, fg=TEXT, relief="flat",
              font=("Segoe UI", 10), padx=10,
              activebackground=BORDER, cursor="hand2").grid(
        row=0, column=1, padx=(6, 0))

    # Status label
    status_var = tk.StringVar(value="")
    status_lbl = tk.Label(form, textvariable=status_var, bg=BG,
                          font=("Segoe UI", 8))
    status_lbl.grid(row=8, column=0, sticky="w", pady=(6, 0))

    # ── Buttons ───────────────────────────────────────────────────────────────
    btn_frame = tk.Frame(root, bg=BG, padx=30, pady=10)
    btn_frame.pack(fill="x", side="bottom")
    btn_frame.columnconfigure(0, weight=1)
    btn_frame.columnconfigure(1, weight=0)
    btn_frame.columnconfigure(2, weight=0)

    def test_connection():
        url = var_url.get().strip().rstrip("/")
        key = var_key.get().strip()
        if not url:
            status_var.set("⚠ URL manquante")
            status_lbl.config(fg="#fbbf24")
            return
        status_var.set("Test en cours...")
        status_lbl.config(fg=DIM)
        root.update()
        try:
            r = requests.get(f"{url}/api/storage",
                             headers={"x-api-key": key}, timeout=5)
            if r.status_code == 200:
                d = r.json()
                status_var.set(
                    f"✓ Connecté — {d['used_gb']} GB / {d['max_gb']} GB utilisés"
                )
                status_lbl.config(fg="#34d399")
            elif r.status_code == 401:
                status_var.set("✗ Clé API invalide")
                status_lbl.config(fg="#f87171")
            else:
                status_var.set(f"✗ Erreur serveur {r.status_code}")
                status_lbl.config(fg="#f87171")
        except Exception as e:
            status_var.set(f"✗ Connexion échouée: {e}")
            status_lbl.config(fg="#f87171")

    def on_save():
        url    = var_url.get().strip().rstrip("/")
        key    = var_key.get().strip()
        name   = var_name.get().strip()
        folder = var_folder.get().strip()

        if not url:
            messagebox.showerror("Erreur", "L'URL du serveur est requise.", parent=root)
            return
        if not key:
            messagebox.showerror("Erreur", "La clé API est requise.", parent=root)
            return
        if not name:
            messagebox.showerror("Erreur", "Le nom du feeder est requis.", parent=root)
            return
        if not folder:
            messagebox.showerror("Erreur", "Choisissez un dossier à surveiller.", parent=root)
            return

        result.update({
            "server_url":   url,
            "api_key":      key,
            "feeder_name":  name,
            "folder_path":  folder,
        })
        root.destroy()

    def on_cancel():
        root.destroy()

    tk.Button(btn_frame, text="Tester la connexion",
              command=test_connection,
              bg=SURFACE, fg=DIM, relief="flat",
              font=("Segoe UI", 9), padx=12, pady=6,
              activebackground=BORDER, cursor="hand2").grid(
        row=0, column=0, sticky="w", pady=(0, 20))

    tk.Button(btn_frame, text="Annuler",
              command=on_cancel,
              bg=SURFACE, fg=DIM, relief="flat",
              font=("Segoe UI", 10), padx=14, pady=8,
              activebackground=BORDER, cursor="hand2").grid(
        row=0, column=1, sticky="e", pady=(0, 20), padx=(0, 8))

    tk.Button(btn_frame, text="Enregistrer & Démarrer",
              command=on_save,
              bg=ACCENT, fg="#ffffff", relief="flat",
              font=("Segoe UI", 10, "bold"), padx=16, pady=8,
              activebackground="#9b8bff", cursor="hand2").grid(
        row=0, column=2, sticky="e", pady=(0, 20))

    root.mainloop()
    return result if result else None
