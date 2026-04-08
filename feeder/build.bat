@echo off
:: ── MediaFeeder v3 — Build script PyInstaller ──────────────────────────────
echo Building MediaFeeder v3...

:: Installer les dépendances si besoin
pip install -r requirements.txt --quiet

:: Build
pyinstaller ^
    --onefile ^
    --noconsole ^
    --name "MediaFeeder_v3" ^
    --icon "NONE" ^
    --add-data "config_ui.py;." ^
    --hidden-import "watchdog.observers.winapi" ^
    --hidden-import "watchdog.observers.read_directory_changes" ^
    main.py

echo.
if exist "dist\MediaFeeder_v3.exe" (
    echo BUILD REUSSI!
    echo Executable: dist\MediaFeeder_v3.exe
    echo.
    echo Instructions:
    echo   1. Copier MediaFeeder_v3.exe sur la machine cible
    echo   2. Double-cliquer pour lancer - une fenetre de config apparait
    echo   3. Renseigner l'URL du serveur, la cle API et le dossier
    echo   4. Cliquer "Enregistrer et Demarrer"
    echo   5. Le feeder demarre et se configure en autostart Windows
) else (
    echo ERREUR: le build a echoue. Verifiez la sortie ci-dessus.
)

pause
