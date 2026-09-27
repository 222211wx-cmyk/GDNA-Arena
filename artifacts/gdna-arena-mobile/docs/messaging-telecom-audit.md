# Audit Messagerie / Appels Android — 27 septembre 2026

## Conclusion et niveau de preuve

### Mise à jour courante — compilation et preuves physiques en attente

Le cycle Telecom décrit comme absent dans l'audit initial ci-dessous est désormais
implémenté dans les sources : pont Kotlin dédié, PhoneAccount self-managed,
ConnectionService entrante/sortante, écran natif verrouillé avec réponse/refus,
et service foreground `phoneCall|microphone`. Le contrôle d'identité et de
l'invitation serveur précède la présentation FCM. Le microphone Agora ne démarre
qu'après action explicite, autorisation serveur/appareil, permission microphone,
activité React reprise et démarrage réussi du service foreground.

Le nettoyage couvre refus, annulation, expiration, fin distante, changement de
compte et erreurs de préparation. Les pertes de focus terminent l'appel plutôt
que de le reprendre automatiquement ; les changements mute/routage Telecom sont
relayés à Agora. Aucun `specialUse` ajouté. Les échecs Telecom/plein écran ne sont
pas présentés comme une réussite notification-only. `hasNativeCallAudio` conserve
sa sémantique iOS ; APNs reste mock-only.

TypeScript passe et **29 tests ciblés natifs/Agora/plugin passent**, dont la
génération idempotente. Ce sont des preuves de source et de tests unitaires, pas
une compilation Kotlin ni une validation appareil. Le build Android clear-cache
a **échoué à la compilation Kotlin** :
https://expo.dev/accounts/qaisypro2024/projects/gdnaarena/builds/2ee2221f-9c1b-4d81-9f64-035d0efae59a

Erreur signalée : `CallTelecomModule.kt:208`, référence `currentActivity` non
résolue. L'accès est corrigé en `reactApplicationContext.currentActivity` pour
React Native 0.81, avec assertion de non-régression sur la source générée.
La compilation de remplacement avec `--clear-cache` a réussi le 27 septembre 2026 :
https://expo.dev/accounts/qaisypro2024/projects/gdnaarena/builds/17a71ac4-1f43-45a2-8edc-70d176ef1c82

APK téléchargé et signature v2 vérifiée avec `apksigner`, un signataire :
https://expo.dev/artifacts/eas/ol34RcfHspy4YKYIzPBiN29a18qN5EIdry_92ScyIaY.apk

SHA-256 : `ea4a754d83ce57ecca3502431c866471b00740d497e3181e388179cf253a4ca5`.
Le démarrage et le comportement sur téléphone restent non certifiés.

Le parcours web d'activation manuelle a été vérifié en développement avec des
comptes de test isolés : activation administrateur, envoi chiffré autorisé,
révocation, refus serveur 403 même avec un statut client falsifié et conservation
de l'historique. Cela ne constitue pas une validation Android physique.

Limites restantes : accepter depuis l'écran verrouillé ouvre l'application
authentifiée ; un verrou sécurisé peut demander le déverrouillage avant la reprise
de l'activité et l'accès au microphone. Aucun contournement n'est revendiqué.
Le routage physique casque/Bluetooth, les interruptions cellulaires, le maintien
audio verrouillé et la réception FCM selon les constructeurs restent à tester.
Cette modification n'ajoute pas de sélecteur explicite haut-parleur/Bluetooth.
Aucun appareil connecté ne fournit de preuve physique.

L'habilitation manuelle administrateur est maintenant implémentée sur web, mobile
et API. La migration de développement est appliquée ; la production nécessite
le **Publish normal**. Ce contrôle d'accès n'est pas une intégration de paiement
ou d'abonnement automatique. Les constats historiques d'absence de gate ci-dessous
ne décrivent donc plus l'état courant.

### Conclusion historique de l'audit initial

**Livraison bloquée.** Le crash signalé par le propriétaire n'est pas reproduit
sur un appareil connecté : `adb devices` ne liste aucun appareil. Aucun démarrage
physique, appel, son bidirectionnel ou réveil FCM n'est certifié. Le message
« Something went wrong » est celui du fallback React et ne permet pas
d'identifier l'exception. Il ne prouve pas un crash du processus Android.

Le code a été audité, TypeScript passe, 25 tests ciblés passent et un export
Android release Hermes a produit un bundle `.hbc`. Ces résultats ne valident
ni le chargement des bibliothèques natives à l'exécution ni Android Telecom.

Nouveau build soumis après ajout de l'import initial gesture-handler :
https://expo.dev/accounts/qaisypro2024/projects/gdnaarena/builds/ea528afe-d940-49e9-8f91-57cbcada8c28
Soumission avec keystore EAS existant ; résultat, signature du fichier final et
démarrage physique à vérifier. Les builds antérieurs ne contiennent pas cet import.

## [BLOQUANT] Démarrage release

| Point | Constat | Action / preuve |
|---|---|---|
| Ordre d'import | `index.js` ne chargeait pas gesture-handler avant l'application | Import ajouté en premier, test de non-régression passé ; cause du crash non prouvée |
| Configuration | Ce projet utilise `app.json`, pas `app.config.js`. `extra.eas.projectId` est présent | Aucun besoin démontré de déplacer l'URL API dans `extra` |
| API release | `lib/api.ts` lit les deux `EXPO_PUBLIC_*`, non `Constants.extra` | `eas.json` fournit le domaine HTTPS de production ; EAS confirme le chargement |
| Mode développement | Le script dev injecte son domaine et utilise un autre environnement | `expo start` ne prouve pas le démarrage d'un APK release |
| Hermes | `android/gradle.properties` contient `hermesEnabled=true` | Export Android release `.hbc` réussi ; pas de raison prouvée de changer de moteur |
| Architecture | New Architecture activée | Ne pas la désactiver arbitrairement : dépendances natives à évaluer ensemble |
| expo-doctor | 17/18 contrôles passent | CallKeep/VoIP Push non testés New Architecture ; Notifee signalé non maintenu. Avertissements conservés |
| Exception réelle | `ErrorBoundary` masque les détails en release | Stack React/logcat du lancement nécessaire avant de déclarer une cause racine |

Les corrections antérieures de signalisation isolent les connexions annulées,
affichent les erreurs WebSocket et traitent les réponses serveur `type:error`.
Elles ne prouvent pas la résolution de ce crash au démarrage.

Le flux sécurisé de vérification production indique la présence du certificat
Agora et du secret TURN, mais ne confirme pas `FIREBASE_SERVICE_ACCOUNT` dans
ce périmètre. Cela ne prouve pas son absence dans tous les environnements.
Aucune valeur secrète consultée et aucune nouvelle demande de secret.
Le JSON Firebase client ne remplace pas l'identité serveur FCM.

## [MESSAGERIE] Architecture et couverture — constat historique

Sources : `app/conversation/[roomId].tsx`, `app/(tabs)/amis.tsx`,
`lib/api.ts`, `lib/native-push.native.ts`, API `routes/messages.ts`,
`lib/signaling.ts`, `lib/message-push.ts`, `lib/expo-push.ts`.

- Persistance PostgreSQL/Drizzle via API ; pas de Supabase Realtime dans ces chemins.
- Envoi HTTP puis diffusion WebSocket authentifiée `/api/ws`. Reconnexion avec
  temporisation et récupération HTTP de l'historique. Pas de boucle de polling
  des messages dans cette conversation mobile.
- Authentification, appartenance à la conversation et enveloppes E2E contrôlées.
  Implémentation inspectée ; pas de preuve d'un échange entre deux APK ici.
- Typing : endpoint et événement serveur présents, mais émission/réception/affichage
  manquent dans la conversation mobile.
- Présence : le serveur diffuse des informations de présence, mais la conversation
  mobile ne les consomme pas comme état live complet. L'état réseau local ne prouve
  pas que le correspondant est joignable.
- Push de nouveau message : enregistrement Expo/native et notification générique
  sans contenu de message ; préférences, mute et destinataires contrôlés.
  Livraisons appareil fermé/verrouillé non validées. Un HTTP 201 peut coexister
  avec une notification asynchrone en échec.
- Aucun verrou `isPro` / `hasActiveSubscription` identifié. Les fonctions ne sont
  pas protégées par abonnement. La politique précédente était appels gratuits et
  Stripe retiré ; cet audit ne réintroduit pas un paiement.
- FlatList inversée et identifiants stables. Historique limité aux 60 derniers
  messages sans pagination mobile ; messages en mémoire et pas d'outbox persistante.
- Cache React Query pour les requêtes ; pas de garantie d'historique hors ligne.
  Images chiffrées déchiffrées en data URI : risque mémoire, cache/miniatures à améliorer.
  Vidéos temporaires nettoyées mais redéchiffrement possible au remontage.

## [APPEL] Android 14 : constat historique et recommandations initiales

Sources : `lib/call-service.native.ts`, `lib/agora-calls.tsx`,
`plugins/withVoipPush.js`, manifeste Android généré, API `routes/rtc.ts`,
`lib/agora-call-authorization.ts`.

### Au moment de l'audit initial, avant le pont Telecom dédié

- Agora : média audio/vidéo natif, clé E2E, jetons serveur liés à l'utilisateur,
  session et appareil autorisé. Signalisation WebSocket ; la notification seule
  ne donne pas l'autorisation d'entrer dans la conversation.
- Android : réception directe Firebase Messaging, alerte Notifee, son personnalisé,
  actions accepter/refuser, FullScreen Intent sous réserve d'autorisation Android.
- `expo-notifications` sert aux notifications ordinaires ; ce n'est pas un moteur Telecom.
- iOS : PushKit (`react-native-voip-push-notification`) et CallKeep/CallKit ;
  envoi APNs mock-only et validation iOS différée.
- CallKeep `ConnectionService` déclaré en Android, mais pas de cycle effectif
  PhoneAccount / connexion entrante / activation / déconnexion dans ce chemin.
- Service CallKeep déclaré `phoneCall|microphone`, service Notifee `phoneCall`,
  service vidéo Expo `mediaPlayback`. Déclarations distinctes, pas un service
  audio d'appel opérationnel combinant ces trois types.
- Absence de cycle explicite accepté → démarrage service audio foreground →
  focus/routage Android → fin et arrêt du service.
- `POST_NOTIFICATIONS` et `USE_FULL_SCREEN_INTENT` présents ; accès plein écran
  vérifié via pont Android 14. `showWhenLocked` / `turnScreenOn` non définis
  explicitement dans le code/plugin examiné ; réveil et interaction à vérifier.
- Aucun gate d'abonnement identifié dans l'autorisation du jeton Agora.

### Architecture recommandée à l'origine

Les points 1 à 4 ont maintenant une implémentation source décrite en tête de ce
document ; leur compilation native et leur comportement physique ne sont pas
encore prouvés. Le point 5 et les contrôles de production restent des gates.

1. Intégration Telecom self-managed réelle : PhoneAccount, ConnectionService,
   état sonnerie, réponse, refus, fin et synchronisation des événements.
2. Service natif d'appel foreground démarré au moment autorisé, notification
   persistante, type(s) adaptés et permissions réellement accordées.
3. Coordination Agora / Telecom / focus audio, interruption par appel cellulaire,
   haut-parleur, Bluetooth, fin distante et libération systématique des ressources.
4. Écran d'appel verrouillé configuré explicitement et accès plein écran vérifié,
   sans contourner les préférences système, DND ou le canal silencieux.
5. FCM serveur et schéma de production vérifiés via Publish normal, puis preuve de
   réception d'une invitation réelle sur l'appareil attendu.

`FOREGROUND_SERVICE_SPECIAL_USE` n'est pas obligatoire pour tous les appels sous
Android 14. Il ne remplace pas les types dédiés, leurs permissions et conditions
d'exécution. Ne pas ajouter `specialUse` ni tous les types en bloc pour contourner
les restrictions ; `mediaPlayback` du lecteur vidéo ne garantit pas le microphone.

### Checklist physique après installation

Noter modèle, version Android, identifiant du build, heure, résultat et message
d'erreur pour chaque cas. Utiliser deux comptes et deux appareils.

- [ ] Installation fraîche et mise à jour sans effacer les données : ouverture,
  connexion, redémarrage de l'application, aucun fallback.
- [ ] Appel entrant au premier plan, en arrière-plan, puis écran verrouillé :
  son personnalisé, bon appelant, aucune prise de microphone avant acceptation.
- [ ] Accepter depuis notification et écran verrouillé : appel exact et son
  bidirectionnel ; refus arrête l'attente côté appelant.
- [ ] Annulation par appelant, expiration et push dupliqué : aucune sonnerie
  persistante ni acceptation d'une invitation terminée.
- [ ] Verrouiller pendant un appel accepté ; vérifier maintien audio, mute,
  haut-parleur, Bluetooth, interruption cellulaire et raccrochage distant.
- [ ] Réseau Wi-Fi, données mobiles, bascule entre eux et perte/reprise réseau.
- [ ] Processus supprimé par Android / retrait des tâches : noter le comportement
  et les restrictions constructeur séparément.
- [ ] Force stop depuis Paramètres : cas distinct, généralement sans réception
  FCM jusqu'à réouverture ; ne pas promettre un réveil dans cet état.
- [ ] Notifications, microphone, plein écran révoqués : erreur explicite ;
  canal muet, mode silencieux et Ne pas déranger respectés.
- [ ] Déconnexion et changement de compte, y compris réseau coupé : aucune
  invitation/action du compte précédent autorisée.
- [ ] Message entrant application fermée puis verrouillée : push et ouverture
  dans la bonne conversation, sans exposer le contenu chiffré.

Le contrôle d'accès manuel administrateur est maintenant implémenté, avec
migration appliquée en développement et Publish normal encore requis pour la
production. Vérifier aussi sur appareils les accès accordés/refusés et leur
révocation. Ne pas confondre cette habilitation, un abonnement aux fournisseurs
et un abonnement payant des citoyens.