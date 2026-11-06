#!/usr/bin/env bash
# ============================================================
# Génère la clé de signature des APK et affiche les 3 secrets à créer
# dans GitHub (Settings → Secrets and variables → Actions) :
#   ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS
#
# La clé reste sur TA machine (par défaut ~/.card-manager/release.keystore),
# jamais dans le dépôt (public). Garde-en une sauvegarde : la perdre empêche
# toute mise à jour des APK déjà installés (il faudrait désinstaller).
#
# Usage : scripts/android-keystore.sh [chemin/du/keystore]
# ============================================================
set -euo pipefail

KS="${1:-$HOME/.card-manager/release.keystore}"
ALIAS="card-manager"

if [ -e "$KS" ]; then
  echo "Une clé existe déjà : $KS (rien n'est écrasé)." >&2
else
  command -v keytool >/dev/null || { echo "keytool introuvable (installer un JDK)." >&2; exit 1; }
  mkdir -p "$(dirname "$KS")"
  read -rsp "Mot de passe de la clé (6 caractères min.) : " PASS; echo
  read -rsp "Confirmer : " PASS2; echo
  [ "$PASS" = "$PASS2" ] || { echo "Les mots de passe diffèrent." >&2; exit 1; }
  [ "${#PASS}" -ge 6 ] || { echo "Mot de passe trop court." >&2; exit 1; }
  keytool -genkeypair -storetype PKCS12 -keystore "$KS" -alias "$ALIAS" \
    -keyalg RSA -keysize 4096 -validity 10000 \
    -storepass "$PASS" -dname "CN=card-manager" >/dev/null
  chmod 600 "$KS"
  echo "Clé créée : $KS"
fi

echo
echo "Secrets à créer dans GitHub → Settings → Secrets and variables → Actions :"
echo "  ANDROID_KEY_ALIAS         = $ALIAS"
echo "  ANDROID_KEYSTORE_PASSWORD = (le mot de passe choisi)"
echo "  ANDROID_KEYSTORE_BASE64   = (contenu ci-dessous, sur une seule ligne)"
echo
base64 -w0 "$KS"; echo
