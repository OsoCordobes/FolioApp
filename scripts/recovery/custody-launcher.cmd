@echo off
rem Owner-only local UI. No execution-policy change, network or secret output.
powershell.exe -NoProfile -STA -WindowStyle Hidden -File "%~dp0custody.ps1"