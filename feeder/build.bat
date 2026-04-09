@echo off
:: ── MediaFeeder Tray — Build script PyInstaller ──────────────────────────────
echo Building MediaFeeder Tray...

:: Installer les dépendances si besoin
pip install -r requirements.txt --quiet

:: Build
pyinstaller ^
    --onefile ^
    --noconsole ^
    --name "MediaFeeder_Tray" ^
    --icon "NONE" ^
    --hidden-import "main" ^
    --hidden-import "config_ui" ^
    --hidden-import "autostart" ^
    --hidden-import "watchdog.observers.winapi" ^
    --hidden-import "watchdog.observers.read_directory_changes" ^
    --hidden-import "pystray._win32" ^
    --hidden-import "PIL._tkinter_finder" ^
    tray.py

:: Copier l'historique des fichiers déjà envoyés pour éviter les re-uploads
if exist "sent_files.json" (
    copy /Y "sent_files.json" "dist\sent_files.json" >nul
    echo Historique sent_files.json copie dans dist\
)

echo.
if exist "dist\MediaFeeder_Tray.exe" (
    echo BUILD REUSSI!
    echo Executable: dist\MediaFeeder_Tray.exe
    echo.
    echo Instructions:
    echo   1. Copier MediaFeeder_Tray.exe sur la machine cible
    echo   2. Double-cliquer — une icone apparait dans la barre des taches
    echo   3. Cercle VERT = feeder ON, Cercle GRIS = feeder OFF
    echo   4. Clic droit sur l'icone pour arreter/demarrer ou voir les logs
) else (
    echo ERREUR: le build a echoue. Verifiez la sortie ci-dessus.
)

pause
