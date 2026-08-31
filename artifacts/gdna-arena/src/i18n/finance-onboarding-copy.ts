import type { Lang } from "@/contexts/LangContext";

const en = {
  accountType: "Account type", details: "Details", terms: "Terms", connect: "Connect",
  payoutAccount: "Payout Account", active: "Active", incomplete: "Incomplete", displayName: "Display name",
  country: "Country", termsLabel: "Terms", acceptedVersion: "Accepted ({{version}})", notAccepted: "Not accepted",
  charges: "Charges", payouts: "Payouts", enabled: "enabled", disabled: "disabled", requirementsDue: "Requirements due:",
  restriction: "Restriction", refreshing: "Refreshing...", resumeStripe: "Resume Stripe onboarding",
  splitTitle: "70 / 30 Split Simulation", simulatedBadge: "Simulated — no money moved",
  splitDescription: "Runs a persisted simulation payment through the backend ledger. Calculates the 70/30 split and records it as a journal entry on the server. No real money is transferred.",
  beneficiaryRequired: "A beneficiary account is required to run simulation payments.", grossAmount: "Gross amount",
  currency: "Currency", description: "Description", simulationPayment: "Simulation payment",
  beneficiary70: "Beneficiary (70%)", platform30: "Platform (30%)", running: "Running...",
  postSimulation: "Post simulation payment", lastSimulation: "Last simulation result", journalId: "Journal ID",
  beneficiary: "Beneficiary", platform: "Platform", duplicate: "Duplicate", yesIdempotent: "Yes (idempotent)", no: "No",
  refunding: "Refunding...", postRefund: "Post refund (ledger reversal)", simulationRecorded: "Simulation payment recorded",
  simulationRefundRecorded: "Simulation refund recorded", ledgerReversalCreated: "Ledger reversal created.",
  simulationFailed: "Simulation failed", refundFailed: "Refund failed",
  bankRedot: "Bank Details & RedotPay", monthlyManual: "Monthly manual", settlementBank: "Settlement bank details",
  bankSecurity: "Account numbers are encrypted server-side. Only the masked form (••••XXXX) is returned to the client — the full number is never exposed after submission.",
  maskedAccount: "Account (masked)", hide: "Hide account", reveal: "Reveal masked account", updateBank: "Update bank details",
  addBank: "Add bank details", accountHolder: "Account holder name", legalAccountName: "Name registered on the account",
  bankName: "Bank name", accountNumber: "Account number / IBAN", routingCode: "Routing code / SWIFT (optional)",
  cancel: "Cancel", saving: "Saving...", saveDetails: "Save details", bankSaved: "Bank details saved",
  bankSavedDescription: "Account number encrypted server-side. Only the masked form is returned.", saveFailed: "Failed to save details",
  monthlyRequest: "Monthly RedotPay request", period: "Period {{period}}", addBankToEnable: "Add bank details above to enable monthly requests.",
  alreadyRequested: "A manual payout request already exists for {{period}}. One request per period is allowed.",
  payoutCalculation: "The payout amount is calculated server-side from your confirmed/simulated 70% ledger allocations minus any already-committed requests.",
  submitting: "Submitting...", submitMonthly: "Submit monthly request", requestHistory: "Request history",
  loadingRequests: "Loading requests...", requestsUnavailable: "RedotPay payout requests are unavailable in simulation mode. Test allocations never become payout obligations.",
  requestSubmitted: "Monthly payout request submitted", requestSubmittedDescription: "RedotPay manual request for {{period}} is now pending admin review.",
  requestFailed: "Failed to submit payout request", pending: "Pending", approved: "Approved", rejected: "Rejected", paid: "Paid",
  signInRequired: "Sign in required", signInDescription: "You must be signed in to set up a payout account.", logIn: "Log in",
  connectRefreshed: "Connect simulation refreshed", noStripeCreated: "No Stripe account or real-money payout was created.",
  accountUpToDate: "Account up to date", payoutsEnabled: "Payouts are already enabled for this account.", refreshFailed: "Failed to get refresh link",
  saveRetry: "Failed to save. Please try again.", stripeSimulated: "Stripe Connect simulated",
  noStripeMoneyCreated: "No Stripe account or real money was created.", stripeStartFailed: "Failed to start Stripe onboarding.",
  serverNotSimulation: "The server is not in finance simulation mode.", stripeSimulationFailed: "Failed to simulate Stripe Connect.",
  selectAccountType: "Select the type of account you are registering.", citizen: "Citizen", citizenDescription: "Individual creator or player",
  event: "Event", eventDescription: "Event organizer or promoter", company: "Company", companyDescription: "Legal entity or business",
  continue: "Continue", legalDetails: "Legal details", legalDetailsDescription: "Enter your legal name and country. This will be verified by Stripe.",
  legalName: "Legal name", displayNamePlaceholder: "How you appear to others", legalNamePlaceholder: "As it appears on your ID or business registration",
  identityNote: "Used for Stripe identity verification. Not shown publicly.", back: "Back",
  reviewTerms: "Review and accept terms", reviewTermsDescription: "Read the net-settlement terms carefully. You must accept them to continue.",
  acceptTerms: "I accept these terms", acceptConfirmation: "— I confirm I have read and understood the net-settlement terms above ({{version}}), including the 70/30 revenue split and Test / Simulation Mode clause.",
  acceptContinue: "Accept and continue", offline: "Offline", stripeOnboarding: "Stripe Connect onboarding",
  stripeDescription: "Connect a Stripe Express account to enable the 70% settlement flow.",
  stripeSecurity: "Bank and card details are collected securely by Stripe — not stored on this platform.",
  termsAccepted: "Terms accepted ({{version}})", accountTypeValue: "Account type: {{type}}", openingStripe: "Opening Stripe...",
  openStripe: "Open Stripe onboarding", stripeRedirect: "You will be redirected to Stripe (test mode). Return here after completing their flow.",
  or: "or", skipRedirect: "Skip redirect — test simulation panels only",
  skipDescription: "Calls the real onboarding endpoint then bypasses the Stripe redirect so you can exercise the 70/30 simulation and payout-rails panels without leaving the app.",
  pageTitle: "Payout Account Setup", pageDescription: "Set up your beneficiary account and verify the settlement flow. This beta runs in Test / Simulation Mode — no real money is moved.",
  simulationMode: "Test / Simulation Mode", simulationBanner: "Connect onboarding and ledger payments are simulated in-page. Test allocations never become Stripe or RedotPay payout obligations.",
  offlineDescription: "You are offline. Mutations are disabled until connection is restored.",
  existingAccount: "You already have a payout account. Resume setup or review its status below.",
  differentType: "Need to register a different account type? Continue below.", registerNew: "Register a new account",
  setupComplete: "Setup complete", completeDescription: "Your account is registered. In Test / Simulation Mode, use the panels below to exercise the 70/30 split logic — no real money moves.",
  goWallet: "Go to wallet", morocco: "Morocco", france: "France", belgium: "Belgium", germany: "Germany",
  unitedKingdom: "United Kingdom", unitedStates: "United States", canada: "Canada", unitedArabEmirates: "United Arab Emirates",
  termsDocument: `Net-Settlement Terms — Arena Qaisypro (v{{version}})

1. Revenue Split
   Platform fee: 30% of each gross transaction.
   Beneficiary net settlement: 70% of each gross transaction.
   These percentages are calculated on gross amounts before any applicable taxes.

2. Test / Simulation Mode (Beta)
   This release operates in Test / Simulation Mode. No real money is moved.
   Stripe Connect runs against Stripe test accounts only, and any 70/30 figures shown are simulated calculations for beta verification purposes only.

3. Payout Processing
   Payouts are processed via Stripe Connect Express (live) or the monthly manual RedotPay request flow (event/company beneficiaries).
   The platform does not collect, store, or process raw bank or card details locally.
   Bank account numbers are encrypted server-side and only the masked form is returned to the client.

4. Currency and Settlement
   Settlements are issued in the currency of your payout account. No exchange rate guarantees are made.

5. Timing
   Payouts are subject to payout schedule and any applicable holding periods.
   The platform reserves the right to delay payouts pending compliance or fraud review.

6. Restrictions
   Payouts require account activation and all due requirements to be satisfied.

7. No Liability for Provider Downtime
   The platform is not liable for delays or failures caused by Stripe Inc., RedotPay, or third-party banking networks.

By clicking "I accept these terms", you confirm that you have read, understood, and agree to these terms.`,
};

type Key = keyof typeof en;
type Dictionary = Record<Key, string>;

const fr: Dictionary = {
  accountType:"Type de compte",details:"Informations",terms:"Conditions",connect:"Connexion",payoutAccount:"Compte de versement",active:"Actif",incomplete:"Incomplet",displayName:"Nom d’affichage",country:"Pays",termsLabel:"Conditions",acceptedVersion:"Acceptées ({{version}})",notAccepted:"Non acceptées",charges:"Prélèvements",payouts:"Versements",enabled:"activés",disabled:"désactivés",requirementsDue:"Exigences requises :",restriction:"Restriction",refreshing:"Actualisation...",resumeStripe:"Reprendre l’intégration Stripe",
  splitTitle:"Simulation de répartition 70 / 30",simulatedBadge:"Simulé — aucun argent déplacé",splitDescription:"Exécute un paiement simulé persistant dans le grand livre du serveur. Calcule la répartition 70/30 et l’enregistre comme écriture comptable. Aucun argent réel n’est transféré.",beneficiaryRequired:"Un compte bénéficiaire est nécessaire pour exécuter des paiements simulés.",grossAmount:"Montant brut",currency:"Devise",description:"Description",simulationPayment:"Paiement simulé",beneficiary70:"Bénéficiaire (70 %)",platform30:"Plateforme (30 %)",running:"Exécution...",postSimulation:"Enregistrer le paiement simulé",lastSimulation:"Dernier résultat de simulation",journalId:"ID du journal",beneficiary:"Bénéficiaire",platform:"Plateforme",duplicate:"Doublon",yesIdempotent:"Oui (idempotent)",no:"Non",refunding:"Remboursement...",postRefund:"Enregistrer le remboursement (contrepassation)",simulationRecorded:"Paiement simulé enregistré",simulationRefundRecorded:"Remboursement simulé enregistré",ledgerReversalCreated:"Contrepassation créée.",simulationFailed:"Échec de la simulation",refundFailed:"Échec du remboursement",
  bankRedot:"Coordonnées bancaires et RedotPay",monthlyManual:"Manuel mensuel",settlementBank:"Coordonnées bancaires de règlement",bankSecurity:"Les numéros de compte sont chiffrés côté serveur. Seule la forme masquée (••••XXXX) est renvoyée au client — le numéro complet n’est jamais exposé après l’envoi.",maskedAccount:"Compte (masqué)",hide:"Masquer le compte",reveal:"Afficher le compte masqué",updateBank:"Mettre à jour les coordonnées bancaires",addBank:"Ajouter des coordonnées bancaires",accountHolder:"Nom du titulaire du compte",legalAccountName:"Nom enregistré sur le compte",bankName:"Nom de la banque",accountNumber:"Numéro de compte / IBAN",routingCode:"Code d’acheminement / SWIFT (facultatif)",cancel:"Annuler",saving:"Enregistrement...",saveDetails:"Enregistrer les informations",bankSaved:"Coordonnées bancaires enregistrées",bankSavedDescription:"Le numéro de compte est chiffré côté serveur. Seule la forme masquée est renvoyée.",saveFailed:"Échec de l’enregistrement des informations",
  monthlyRequest:"Demande mensuelle RedotPay",period:"Période {{period}}",addBankToEnable:"Ajoutez les coordonnées bancaires ci-dessus pour activer les demandes mensuelles.",alreadyRequested:"Une demande de versement manuel existe déjà pour {{period}}. Une seule demande est autorisée par période.",payoutCalculation:"Le montant du versement est calculé côté serveur à partir de vos allocations confirmées/simulées de 70 %, moins les demandes déjà engagées.",submitting:"Envoi...",submitMonthly:"Envoyer la demande mensuelle",requestHistory:"Historique des demandes",loadingRequests:"Chargement des demandes...",requestsUnavailable:"Les demandes de versement RedotPay ne sont pas disponibles en mode simulation. Les allocations de test ne deviennent jamais des obligations de versement.",requestSubmitted:"Demande mensuelle envoyée",requestSubmittedDescription:"La demande manuelle RedotPay pour {{period}} est en attente d’examen administratif.",requestFailed:"Échec de l’envoi de la demande",pending:"En attente",approved:"Approuvée",rejected:"Rejetée",paid:"Payée",
  signInRequired:"Connexion requise",signInDescription:"Vous devez être connecté pour configurer un compte de versement.",logIn:"Se connecter",connectRefreshed:"Simulation Connect actualisée",noStripeCreated:"Aucun compte Stripe ni versement en argent réel n’a été créé.",accountUpToDate:"Compte à jour",payoutsEnabled:"Les versements sont déjà activés pour ce compte.",refreshFailed:"Impossible d’obtenir le lien d’actualisation",saveRetry:"Échec de l’enregistrement. Veuillez réessayer.",stripeSimulated:"Stripe Connect simulé",noStripeMoneyCreated:"Aucun compte Stripe ni argent réel n’a été créé.",stripeStartFailed:"Impossible de démarrer l’intégration Stripe.",serverNotSimulation:"Le serveur n’est pas en mode simulation financière.",stripeSimulationFailed:"Échec de la simulation Stripe Connect.",
  selectAccountType:"Sélectionnez le type de compte que vous enregistrez.",citizen:"Citoyen",citizenDescription:"Créateur ou joueur individuel",event:"Événement",eventDescription:"Organisateur ou promoteur d’événement",company:"Entreprise",companyDescription:"Entité juridique ou entreprise",continue:"Continuer",legalDetails:"Informations légales",legalDetailsDescription:"Saisissez votre nom légal et votre pays. Stripe les vérifiera.",legalName:"Nom légal",displayNamePlaceholder:"Nom visible par les autres",legalNamePlaceholder:"Tel qu’il figure sur votre pièce d’identité ou registre professionnel",identityNote:"Utilisé pour la vérification d’identité Stripe. Non affiché publiquement.",back:"Retour",reviewTerms:"Vérifier et accepter les conditions",reviewTermsDescription:"Lisez attentivement les conditions de règlement net. Vous devez les accepter pour continuer.",acceptTerms:"J’accepte ces conditions",acceptConfirmation:"— Je confirme avoir lu et compris les conditions de règlement net ci-dessus ({{version}}), y compris la répartition 70/30 et la clause du mode test / simulation.",acceptContinue:"Accepter et continuer",offline:"Hors ligne",
  stripeOnboarding:"Intégration Stripe Connect",stripeDescription:"Connectez un compte Stripe Express pour activer le flux de règlement à 70 %.",stripeSecurity:"Les coordonnées bancaires et de carte sont recueillies en toute sécurité par Stripe — elles ne sont pas stockées sur cette plateforme.",termsAccepted:"Conditions acceptées ({{version}})",accountTypeValue:"Type de compte : {{type}}",openingStripe:"Ouverture de Stripe...",openStripe:"Ouvrir l’intégration Stripe",stripeRedirect:"Vous serez redirigé vers Stripe (mode test). Revenez ici après avoir terminé leur parcours.",or:"ou",skipRedirect:"Ignorer la redirection — panneaux de simulation uniquement",skipDescription:"Appelle le véritable point d’accès d’intégration puis contourne la redirection Stripe afin de tester les panneaux de simulation 70/30 et de versement sans quitter l’application.",
  pageTitle:"Configuration du compte de versement",pageDescription:"Configurez votre compte bénéficiaire et vérifiez le flux de règlement. Cette version bêta fonctionne en mode test / simulation — aucun argent réel n’est déplacé.",simulationMode:"Mode test / simulation",simulationBanner:"L’intégration Connect et les paiements du grand livre sont simulés dans la page. Les allocations de test ne deviennent jamais des obligations Stripe ou RedotPay.",offlineDescription:"Vous êtes hors ligne. Les modifications sont désactivées jusqu’au rétablissement de la connexion.",existingAccount:"Vous avez déjà un compte de versement. Reprenez la configuration ou consultez son statut ci-dessous.",differentType:"Vous devez enregistrer un autre type de compte ? Continuez ci-dessous.",registerNew:"Enregistrer un nouveau compte",setupComplete:"Configuration terminée",completeDescription:"Votre compte est enregistré. En mode test / simulation, utilisez les panneaux ci-dessous pour tester la répartition 70/30 — aucun argent réel ne circule.",goWallet:"Accéder au portefeuille",morocco:"Maroc",france:"France",belgium:"Belgique",germany:"Allemagne",unitedKingdom:"Royaume-Uni",unitedStates:"États-Unis",canada:"Canada",unitedArabEmirates:"Émirats arabes unis",
  termsDocument:`Conditions de règlement net — Arena Qaisypro (v{{version}})

1. Répartition des revenus
   Frais de plateforme : 30 % de chaque transaction brute.
   Règlement net du bénéficiaire : 70 % de chaque transaction brute.
   Ces pourcentages sont calculés sur les montants bruts avant toute taxe applicable.

2. Mode test / simulation (bêta)
   Cette version fonctionne en mode test / simulation. Aucun argent réel n’est déplacé. Stripe Connect utilise uniquement des comptes de test Stripe et les chiffres 70/30 affichés sont des calculs simulés réservés à la vérification bêta.

3. Traitement des versements
   Les versements passent par Stripe Connect Express (direct) ou la demande manuelle mensuelle RedotPay (bénéficiaires événement/entreprise). La plateforme ne collecte, ne stocke et ne traite aucune donnée bancaire ou de carte brute localement. Les numéros de compte sont chiffrés côté serveur et seule leur forme masquée est renvoyée.

4. Devise et règlement
   Les règlements sont émis dans la devise du compte de versement. Aucun taux de change n’est garanti.

5. Délais
   Les versements sont soumis au calendrier et aux éventuelles périodes de retenue. La plateforme peut les retarder pour un contrôle de conformité ou de fraude.

6. Restrictions
   Les versements exigent l’activation du compte et la satisfaction de toutes les exigences.

7. Absence de responsabilité en cas d’indisponibilité
   La plateforme n’est pas responsable des retards ou défaillances causés par Stripe Inc., RedotPay ou les réseaux bancaires tiers.

En cliquant sur « J’accepte ces conditions », vous confirmez les avoir lues, comprises et acceptées.`,
};

const es: Dictionary = {
  accountType:"Tipo de cuenta",details:"Datos",terms:"Términos",connect:"Conectar",payoutAccount:"Cuenta de pagos",active:"Activa",incomplete:"Incompleta",displayName:"Nombre para mostrar",country:"País",termsLabel:"Términos",acceptedVersion:"Aceptados ({{version}})",notAccepted:"No aceptados",charges:"Cobros",payouts:"Pagos",enabled:"activados",disabled:"desactivados",requirementsDue:"Requisitos pendientes:",restriction:"Restricción",refreshing:"Actualizando...",resumeStripe:"Reanudar incorporación de Stripe",
  splitTitle:"Simulación de reparto 70 / 30",simulatedBadge:"Simulado — no se movió dinero",splitDescription:"Ejecuta un pago simulado persistente en el libro mayor del servidor. Calcula el reparto 70/30 y lo registra como asiento. No se transfiere dinero real.",beneficiaryRequired:"Se requiere una cuenta beneficiaria para ejecutar pagos simulados.",grossAmount:"Importe bruto",currency:"Moneda",description:"Descripción",simulationPayment:"Pago simulado",beneficiary70:"Beneficiario (70 %)",platform30:"Plataforma (30 %)",running:"Ejecutando...",postSimulation:"Registrar pago simulado",lastSimulation:"Último resultado de simulación",journalId:"ID del diario",beneficiary:"Beneficiario",platform:"Plataforma",duplicate:"Duplicado",yesIdempotent:"Sí (idempotente)",no:"No",refunding:"Reembolsando...",postRefund:"Registrar reembolso (reversión)",simulationRecorded:"Pago simulado registrado",simulationRefundRecorded:"Reembolso simulado registrado",ledgerReversalCreated:"Se creó la reversión contable.",simulationFailed:"Error en la simulación",refundFailed:"Error en el reembolso",
  bankRedot:"Datos bancarios y RedotPay",monthlyManual:"Manual mensual",settlementBank:"Datos bancarios de liquidación",bankSecurity:"Los números de cuenta se cifran en el servidor. Solo se devuelve al cliente la forma oculta (••••XXXX); el número completo nunca se muestra tras el envío.",maskedAccount:"Cuenta (oculta)",hide:"Ocultar cuenta",reveal:"Mostrar cuenta oculta",updateBank:"Actualizar datos bancarios",addBank:"Añadir datos bancarios",accountHolder:"Nombre del titular de la cuenta",legalAccountName:"Nombre registrado en la cuenta",bankName:"Nombre del banco",accountNumber:"Número de cuenta / IBAN",routingCode:"Código bancario / SWIFT (opcional)",cancel:"Cancelar",saving:"Guardando...",saveDetails:"Guardar datos",bankSaved:"Datos bancarios guardados",bankSavedDescription:"El número de cuenta se cifró en el servidor. Solo se devuelve la forma oculta.",saveFailed:"No se pudieron guardar los datos",
  monthlyRequest:"Solicitud mensual de RedotPay",period:"Período {{period}}",addBankToEnable:"Añade los datos bancarios arriba para activar las solicitudes mensuales.",alreadyRequested:"Ya existe una solicitud de pago manual para {{period}}. Solo se permite una por período.",payoutCalculation:"El importe se calcula en el servidor a partir de tus asignaciones confirmadas/simuladas del 70 %, menos las solicitudes ya comprometidas.",submitting:"Enviando...",submitMonthly:"Enviar solicitud mensual",requestHistory:"Historial de solicitudes",loadingRequests:"Cargando solicitudes...",requestsUnavailable:"Las solicitudes de pago RedotPay no están disponibles en modo de simulación. Las asignaciones de prueba nunca se convierten en obligaciones de pago.",requestSubmitted:"Solicitud mensual enviada",requestSubmittedDescription:"La solicitud manual de RedotPay para {{period}} está pendiente de revisión administrativa.",requestFailed:"No se pudo enviar la solicitud",pending:"Pendiente",approved:"Aprobada",rejected:"Rechazada",paid:"Pagada",
  signInRequired:"Se requiere iniciar sesión",signInDescription:"Debes iniciar sesión para configurar una cuenta de pagos.",logIn:"Iniciar sesión",connectRefreshed:"Simulación de Connect actualizada",noStripeCreated:"No se creó ninguna cuenta de Stripe ni pago con dinero real.",accountUpToDate:"Cuenta actualizada",payoutsEnabled:"Los pagos ya están activados para esta cuenta.",refreshFailed:"No se pudo obtener el enlace de actualización",saveRetry:"No se pudo guardar. Inténtalo de nuevo.",stripeSimulated:"Stripe Connect simulado",noStripeMoneyCreated:"No se creó ninguna cuenta de Stripe ni dinero real.",stripeStartFailed:"No se pudo iniciar la incorporación de Stripe.",serverNotSimulation:"El servidor no está en modo de simulación financiera.",stripeSimulationFailed:"No se pudo simular Stripe Connect.",
  selectAccountType:"Selecciona el tipo de cuenta que vas a registrar.",citizen:"Ciudadano",citizenDescription:"Creador o jugador individual",event:"Evento",eventDescription:"Organizador o promotor de eventos",company:"Empresa",companyDescription:"Entidad jurídica o empresa",continue:"Continuar",legalDetails:"Datos legales",legalDetailsDescription:"Introduce tu nombre legal y país. Stripe los verificará.",legalName:"Nombre legal",displayNamePlaceholder:"Cómo te ven los demás",legalNamePlaceholder:"Tal como aparece en tu identificación o registro empresarial",identityNote:"Se usa para verificar la identidad en Stripe. No se muestra públicamente.",back:"Atrás",reviewTerms:"Revisar y aceptar los términos",reviewTermsDescription:"Lee atentamente los términos de liquidación neta. Debes aceptarlos para continuar.",acceptTerms:"Acepto estos términos",acceptConfirmation:"— Confirmo que he leído y comprendido los términos de liquidación neta anteriores ({{version}}), incluido el reparto 70/30 y la cláusula del modo de prueba / simulación.",acceptContinue:"Aceptar y continuar",offline:"Sin conexión",
  stripeOnboarding:"Incorporación de Stripe Connect",stripeDescription:"Conecta una cuenta Stripe Express para activar el flujo de liquidación del 70 %.",stripeSecurity:"Stripe recopila de forma segura los datos bancarios y de tarjeta; no se almacenan en esta plataforma.",termsAccepted:"Términos aceptados ({{version}})",accountTypeValue:"Tipo de cuenta: {{type}}",openingStripe:"Abriendo Stripe...",openStripe:"Abrir incorporación de Stripe",stripeRedirect:"Se te redirigirá a Stripe (modo de prueba). Regresa aquí al completar el proceso.",or:"o",skipRedirect:"Omitir redirección — solo paneles de simulación",skipDescription:"Llama al endpoint real de incorporación y omite la redirección de Stripe para que pruebes los paneles de simulación 70/30 y vías de pago sin salir de la aplicación.",
  pageTitle:"Configuración de la cuenta de pagos",pageDescription:"Configura tu cuenta beneficiaria y verifica el flujo de liquidación. Esta beta funciona en modo de prueba / simulación: no se mueve dinero real.",simulationMode:"Modo de prueba / simulación",simulationBanner:"La incorporación de Connect y los pagos del libro mayor se simulan en la página. Las asignaciones de prueba nunca se convierten en obligaciones de Stripe o RedotPay.",offlineDescription:"No tienes conexión. Las modificaciones están desactivadas hasta que se restablezca.",existingAccount:"Ya tienes una cuenta de pagos. Reanuda la configuración o revisa su estado abajo.",differentType:"¿Necesitas registrar otro tipo de cuenta? Continúa abajo.",registerNew:"Registrar una cuenta nueva",setupComplete:"Configuración completa",completeDescription:"Tu cuenta está registrada. En modo de prueba / simulación, usa los paneles inferiores para probar el reparto 70/30; no se mueve dinero real.",goWallet:"Ir a la cartera",morocco:"Marruecos",france:"Francia",belgium:"Bélgica",germany:"Alemania",unitedKingdom:"Reino Unido",unitedStates:"Estados Unidos",canada:"Canadá",unitedArabEmirates:"Emiratos Árabes Unidos",
  termsDocument:`Términos de liquidación neta — Arena Qaisypro (v{{version}})

1. Reparto de ingresos
   Comisión de plataforma: 30 % de cada transacción bruta.
   Liquidación neta del beneficiario: 70 % de cada transacción bruta.
   Estos porcentajes se calculan sobre importes brutos antes de los impuestos aplicables.

2. Modo de prueba / simulación (beta)
   Esta versión funciona en modo de prueba / simulación. No se mueve dinero real. Stripe Connect usa exclusivamente cuentas de prueba y las cifras 70/30 mostradas son cálculos simulados para verificar la beta.

3. Procesamiento de pagos
   Los pagos se procesan mediante Stripe Connect Express (en vivo) o la solicitud manual mensual de RedotPay (beneficiarios de evento/empresa). La plataforma no recopila, almacena ni procesa localmente datos bancarios o de tarjeta sin ocultar. Los números de cuenta se cifran en el servidor y solo se devuelve su forma oculta.

4. Moneda y liquidación
   Las liquidaciones se emiten en la moneda de la cuenta de pagos. No se garantiza ningún tipo de cambio.

5. Plazos
   Los pagos están sujetos al calendario y a los períodos de retención aplicables. La plataforma puede retrasarlos mientras realiza revisiones de cumplimiento o fraude.

6. Restricciones
   Los pagos requieren que la cuenta esté activada y que se cumplan todos los requisitos.

7. Exención por indisponibilidad del proveedor
   La plataforma no responde por retrasos o fallos causados por Stripe Inc., RedotPay o redes bancarias externas.

Al hacer clic en «Acepto estos términos», confirmas que los has leído, comprendido y aceptado.`,
};

const ar: Dictionary = {
  accountType:"نوع الحساب",details:"التفاصيل",terms:"الشروط",connect:"الربط",payoutAccount:"حساب الدفعات",active:"نشط",incomplete:"غير مكتمل",displayName:"اسم العرض",country:"البلد",termsLabel:"الشروط",acceptedVersion:"مقبولة ({{version}})",notAccepted:"غير مقبولة",charges:"التحصيلات",payouts:"الدفعات",enabled:"مفعّلة",disabled:"معطّلة",requirementsDue:"المتطلبات المستحقة:",restriction:"التقييد",refreshing:"جارٍ التحديث...",resumeStripe:"استئناف إعداد Stripe",
  splitTitle:"محاكاة تقسيم 70 / 30",simulatedBadge:"محاكاة — لم يتم نقل أي أموال",splitDescription:"تشغّل دفعة محاكاة دائمة عبر دفتر الأستاذ في الخادم، وتحسب تقسيم 70/30 وتسجله كقيد. لا يتم تحويل أي أموال حقيقية.",beneficiaryRequired:"يلزم حساب مستفيد لتشغيل دفعات المحاكاة.",grossAmount:"المبلغ الإجمالي",currency:"العملة",description:"الوصف",simulationPayment:"دفعة محاكاة",beneficiary70:"المستفيد (70٪)",platform30:"المنصة (30٪)",running:"جارٍ التشغيل...",postSimulation:"تسجيل دفعة المحاكاة",lastSimulation:"نتيجة آخر محاكاة",journalId:"معرّف دفتر اليومية",beneficiary:"المستفيد",platform:"المنصة",duplicate:"مكرر",yesIdempotent:"نعم (آمن من التكرار)",no:"لا",refunding:"جارٍ رد المبلغ...",postRefund:"تسجيل رد المبلغ (قيد عكسي)",simulationRecorded:"تم تسجيل دفعة المحاكاة",simulationRefundRecorded:"تم تسجيل رد مبلغ المحاكاة",ledgerReversalCreated:"تم إنشاء قيد عكسي.",simulationFailed:"فشلت المحاكاة",refundFailed:"فشل رد المبلغ",
  bankRedot:"التفاصيل البنكية وRedotPay",monthlyManual:"يدوي شهري",settlementBank:"تفاصيل بنك التسوية",bankSecurity:"تُشفّر أرقام الحسابات على الخادم. لا يُعاد إلى العميل سوى الشكل المخفي (••••XXXX)، ولا يظهر الرقم الكامل بعد الإرسال.",maskedAccount:"الحساب (مخفي)",hide:"إخفاء الحساب",reveal:"إظهار الحساب المخفي",updateBank:"تحديث التفاصيل البنكية",addBank:"إضافة تفاصيل بنكية",accountHolder:"اسم صاحب الحساب",legalAccountName:"الاسم المسجل في الحساب",bankName:"اسم البنك",accountNumber:"رقم الحساب / IBAN",routingCode:"رمز التوجيه / SWIFT (اختياري)",cancel:"إلغاء",saving:"جارٍ الحفظ...",saveDetails:"حفظ التفاصيل",bankSaved:"تم حفظ التفاصيل البنكية",bankSavedDescription:"شُفّر رقم الحساب على الخادم. لا يُعاد سوى الشكل المخفي.",saveFailed:"تعذر حفظ التفاصيل",
  monthlyRequest:"طلب RedotPay الشهري",period:"الفترة {{period}}",addBankToEnable:"أضف التفاصيل البنكية أعلاه لتفعيل الطلبات الشهرية.",alreadyRequested:"يوجد طلب دفعة يدوي للفترة {{period}} بالفعل. يُسمح بطلب واحد لكل فترة.",payoutCalculation:"يُحسب مبلغ الدفعة على الخادم من مخصصات دفتر الأستاذ المؤكدة/المحاكية بنسبة 70٪ بعد خصم الطلبات الملتزم بها.",submitting:"جارٍ الإرسال...",submitMonthly:"إرسال الطلب الشهري",requestHistory:"سجل الطلبات",loadingRequests:"جارٍ تحميل الطلبات...",requestsUnavailable:"طلبات دفعات RedotPay غير متاحة في وضع المحاكاة. لا تصبح مخصصات الاختبار التزامات دفع أبدًا.",requestSubmitted:"تم إرسال طلب الدفعة الشهري",requestSubmittedDescription:"طلب RedotPay اليدوي للفترة {{period}} قيد مراجعة الإدارة الآن.",requestFailed:"تعذر إرسال طلب الدفعة",pending:"قيد الانتظار",approved:"مقبول",rejected:"مرفوض",paid:"مدفوع",
  signInRequired:"تسجيل الدخول مطلوب",signInDescription:"يجب تسجيل الدخول لإعداد حساب الدفعات.",logIn:"تسجيل الدخول",connectRefreshed:"تم تحديث محاكاة Connect",noStripeCreated:"لم يتم إنشاء حساب Stripe أو دفعة بأموال حقيقية.",accountUpToDate:"الحساب محدّث",payoutsEnabled:"الدفعات مفعّلة بالفعل لهذا الحساب.",refreshFailed:"تعذر الحصول على رابط التحديث",saveRetry:"تعذر الحفظ. حاول مرة أخرى.",stripeSimulated:"تمت محاكاة Stripe Connect",noStripeMoneyCreated:"لم يتم إنشاء حساب Stripe أو أموال حقيقية.",stripeStartFailed:"تعذر بدء إعداد Stripe.",serverNotSimulation:"الخادم ليس في وضع المحاكاة المالية.",stripeSimulationFailed:"فشلت محاكاة Stripe Connect.",
  selectAccountType:"اختر نوع الحساب الذي تسجله.",citizen:"مواطن",citizenDescription:"منشئ محتوى أو لاعب فردي",event:"فعالية",eventDescription:"منظم أو مروّج فعالية",company:"شركة",companyDescription:"كيان قانوني أو شركة",continue:"متابعة",legalDetails:"التفاصيل القانونية",legalDetailsDescription:"أدخل اسمك القانوني وبلدك. سيتحقق Stripe منهما.",legalName:"الاسم القانوني",displayNamePlaceholder:"كيف تظهر للآخرين",legalNamePlaceholder:"كما يظهر في هويتك أو تسجيل شركتك",identityNote:"يُستخدم للتحقق من الهوية لدى Stripe ولا يظهر للعامة.",back:"رجوع",reviewTerms:"مراجعة الشروط وقبولها",reviewTermsDescription:"اقرأ شروط صافي التسوية بعناية. يجب قبولها للمتابعة.",acceptTerms:"أوافق على هذه الشروط",acceptConfirmation:"— أؤكد أنني قرأت وفهمت شروط صافي التسوية أعلاه ({{version}})، بما فيها تقسيم الإيرادات 70/30 وبند وضع الاختبار / المحاكاة.",acceptContinue:"قبول ومتابعة",offline:"غير متصل",
  stripeOnboarding:"إعداد Stripe Connect",stripeDescription:"اربط حساب Stripe Express لتفعيل تدفق التسوية بنسبة 70٪.",stripeSecurity:"يجمع Stripe تفاصيل البنك والبطاقة بأمان — ولا تُخزّن على هذه المنصة.",termsAccepted:"تم قبول الشروط ({{version}})",accountTypeValue:"نوع الحساب: {{type}}",openingStripe:"جارٍ فتح Stripe...",openStripe:"فتح إعداد Stripe",stripeRedirect:"ستتم إعادة توجيهك إلى Stripe (وضع الاختبار). عُد إلى هنا بعد إكمال العملية.",or:"أو",skipRedirect:"تخطي إعادة التوجيه — لوحات المحاكاة فقط",skipDescription:"يستدعي نقطة الإعداد الحقيقية ثم يتجاوز إعادة توجيه Stripe لتتمكن من تجربة لوحات محاكاة 70/30 ومسارات الدفعات دون مغادرة التطبيق.",
  pageTitle:"إعداد حساب الدفعات",pageDescription:"أعدّ حساب المستفيد وتحقق من تدفق التسوية. تعمل هذه النسخة التجريبية في وضع الاختبار / المحاكاة — لا يتم نقل أي أموال حقيقية.",simulationMode:"وضع الاختبار / المحاكاة",simulationBanner:"تتم محاكاة إعداد Connect ودفعات دفتر الأستاذ داخل الصفحة. لا تصبح مخصصات الاختبار التزامات دفع لدى Stripe أو RedotPay.",offlineDescription:"أنت غير متصل. التعديلات معطلة حتى استعادة الاتصال.",existingAccount:"لديك حساب دفعات بالفعل. استأنف الإعداد أو راجع حالته أدناه.",differentType:"هل تحتاج إلى تسجيل نوع حساب مختلف؟ تابع أدناه.",registerNew:"تسجيل حساب جديد",setupComplete:"اكتمل الإعداد",completeDescription:"تم تسجيل حسابك. في وضع الاختبار / المحاكاة، استخدم اللوحات أدناه لتجربة منطق تقسيم 70/30 — لا تتحرك أموال حقيقية.",goWallet:"الذهاب إلى المحفظة",morocco:"المغرب",france:"فرنسا",belgium:"بلجيكا",germany:"ألمانيا",unitedKingdom:"المملكة المتحدة",unitedStates:"الولايات المتحدة",canada:"كندا",unitedArabEmirates:"الإمارات العربية المتحدة",
  termsDocument:`شروط صافي التسوية — Arena Qaisypro (الإصدار {{version}})

1. تقسيم الإيرادات
   رسوم المنصة: 30٪ من كل معاملة إجمالية.
   صافي تسوية المستفيد: 70٪ من كل معاملة إجمالية.
   تُحسب هذه النسب على المبالغ الإجمالية قبل أي ضرائب سارية.

2. وضع الاختبار / المحاكاة (تجريبي)
   يعمل هذا الإصدار في وضع الاختبار / المحاكاة، ولا تُنقل أموال حقيقية. يستخدم Stripe Connect حسابات اختبار Stripe فقط، وكل أرقام 70/30 المعروضة حسابات محاكاة للتحقق من النسخة التجريبية.

3. معالجة الدفعات
   تُعالج الدفعات عبر Stripe Connect Express (مباشر) أو مسار طلب RedotPay اليدوي الشهري (لمستفيدي الفعاليات/الشركات). لا تجمع المنصة بيانات البنك أو البطاقة الخام ولا تخزنها أو تعالجها محليًا. تُشفّر أرقام الحسابات على الخادم ولا يُعاد للعميل سوى شكلها المخفي.

4. العملة والتسوية
   تصدر التسويات بعملة حساب الدفعات، ولا تُقدّم ضمانات لأسعار الصرف.

5. التوقيت
   تخضع الدفعات لجدول الدفع وأي فترات حجز سارية. يحق للمنصة تأخيرها لحين مراجعة الامتثال أو الاحتيال.

6. القيود
   تتطلب الدفعات تفعيل الحساب واستيفاء جميع المتطلبات المستحقة.

7. عدم المسؤولية عن توقف المزوّد
   لا تتحمل المنصة مسؤولية التأخير أو الإخفاق الناتج عن Stripe Inc. أو RedotPay أو شبكات البنوك الخارجية.

بالنقر على «أوافق على هذه الشروط»، تؤكد أنك قرأتها وفهمتها ووافقت عليها.`,
};

const de: Dictionary = {
  accountType: "Kontoart",
  details: "Details",
  terms: "Bedingungen",
  connect: "Verbinden",
  payoutAccount: "Auszahlungskonto",
  active: "Aktiv",
  incomplete: "Unvollständig",
  displayName: "Anzeigename",
  country: "Land",
  termsLabel: "Bedingungen",
  acceptedVersion: "Akzeptiert ({{version}})",
  notAccepted: "Nicht angenommen",
  charges: "Gebühren",
  payouts: "Auszahlungen",
  enabled: "aktiviert",
  disabled: "deaktiviert",
  requirementsDue: "Fällige Anforderungen:",
  restriction: "Einschränkung",
  refreshing: "Wird aktualisiert...",
  resumeStripe: "Stripe-Onboarding fortsetzen",
  splitTitle: "70 / 30 Split-Simulation",
  simulatedBadge: "Simuliert — kein Geld bewegt",
  splitDescription: "Führt eine dauerhafte Simulationszahlung über das Backend-Ledger aus. Berechnet den 70/30 Split und zeichnet diesen als Journaleintrag auf dem Server auf. Es wird kein echtes Geld überwiesen.",
  beneficiaryRequired: "Für die Durchführung von Simulationszahlungen ist ein Begünstigtenkonto erforderlich.",
  grossAmount: "Bruttobetrag",
  currency: "Währung",
  description: "Beschreibung",
  simulationPayment: "Simulationszahlung",
  beneficiary70: "Begünstigter (70 %)",
  platform30: "Plattform (30%)",
  running: "Läuft... Bitte warten...",
  postSimulation: "Zahlung nach der Simulation",
  lastSimulation: "Simulationsergebnis",
  journalId: "Journal-ID",
  beneficiary: "Berechtigte",
  platform: "Bühne",
  duplicate: "Duplizieren",
  yesIdempotent: "Ja (idempotent)",
  no: "Nr.",
  refunding: "Refundierungen",
  postRefund: "Rückerstattung buchen (Ledger Storno)",
  simulationRecorded: "Simulationszahlung erfasst",
  simulationRefundRecorded: "Simulationsrückerstattung erfasst",
  ledgerReversalCreated: "Ledger Storno erstellt.",
  simulationFailed: "Simulation fehlgeschlagen",
  refundFailed: "Erstattung fehlgeschlagen",
  bankRedot: "Bankverbindung & RedotPay",
  monthlyManual: "Monatshandbuch",
  settlementBank: "Verrechnungsbankverbindung",
  bankSecurity: "Kontonummern sind serverseitig verschlüsselt. Nur das maskierte Formular (••••XXXX) wird an den Kunden zurückgesandt — die vollständige Nummer wird nach dem Absenden nie freigelegt.",
  maskedAccount: "Konto (maskiert)",
  hide: "In Account verstecken",
  reveal: "Maskiertes Konto anzeigen",
  updateBank: "Ihre Bankdaten aktualisieren;",
  addBank: "Fügen Sie Ihre Bankverbindung hinzu",
  accountHolder: "Kontoinhaber Name",
  legalAccountName: "Name, der auf dem Konto registriert ist",
  bankName: "Name der Bank",
  accountNumber: "Kontonummer / IBAN",
  routingCode: "Routingcode/ SWIFT (optional)",
  cancel: "Abbrechen",
  saving: "Speicherung...",
  saveDetails: "Angaben speichern",
  bankSaved: "Die gespeicherte Bankverbindung",
  bankSavedDescription: "Kontonummer serverseitig verschlüsselt. Es wird nur das maskierte Formular zurückgegeben.",
  saveFailed: "Details konnten nicht gespeichert werden",
  monthlyRequest: "Monatliche RedotPay-Anfrage",
  period: "Zeitraum {{period}}",
  addBankToEnable: "Füge oben Bankdaten hinzu, um monatliche Anfragen zu ermöglichen.",
  alreadyRequested: "Für {{period}} existiert bereits eine manuelle Auszahlungsanforderung. Eine Anfrage pro Zeitraum ist zulässig.",
  payoutCalculation: "Der Auszahlungsbetrag wird serverseitig aus deinen bestätigten/simulierten 70 % Ledger-Zuweisungen abzüglich aller bereits zugesagten Anfragen berechnet.",
  submitting: "Übermittlung...",
  submitMonthly: "Monatliche Anfrage einreichen",
  requestHistory: "Anfrageverlauf",
  loadingRequests: "Anfragen werden geladen...",
  requestsUnavailable: "RedotPay-Auszahlungsanfragen sind im Simulationsmodus nicht verfügbar. Testumlagen werden nie zu Auszahlungsverpflichtungen.",
  requestSubmitted: "Monatliche Auszahlungsanforderung eingereicht",
  requestSubmittedDescription: "Die manuelle RedotPay-Anfrage für {{period}} steht nun zur Überprüfung durch den Administrator aus.",
  requestFailed: "Fehler beim Senden der Auszahlungsanforderung",
  pending: "Ausstehend",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  paid: "Bezahlt .",
  signInRequired: "Registrierung notwendig",
  signInDescription: "Du musst angemeldet sein, um ein Auszahlungskonto einzurichten.",
  logIn: "Anmelden",
  connectRefreshed: "Verbindungssimulation aktualisiert",
  noStripeCreated: "Es wurde kein Stripe-Konto oder eine Echtgeldauszahlung erstellt.",
  accountUpToDate: "Konto auf dem neuesten Stand",
  payoutsEnabled: "Auszahlungen sind für dieses Konto bereits aktiviert.",
  refreshFailed: "Fehler beim Abrufen des Aktualisierungslinks",
  saveRetry: "Rückstellungen konnten nicht gespeichert werden. Bitte versuchen Sie es erneut.",
  stripeSimulated: "Stripe Connect simuliert",
  noStripeMoneyCreated: "Es wurde kein Stripe-Konto oder echtes Geld erstellt.",
  stripeStartFailed: "Das Stripe-Onboarding konnte nicht gestartet werden.",
  serverNotSimulation: "Der Server befindet sich nicht im Finanzsimulationsmodus.",
  stripeSimulationFailed: "Stripe Connect konnte nicht simuliert werden.",
  selectAccountType: "Wählen Sie die Art des Kontos aus, das Sie registrieren.",
  citizen: "Citizen",
  citizenDescription: "Individueller Ersteller oder Spieler",
  event: "Event",
  eventDescription: "Veranstalter oder Veranstalter",
  company: "Unternehmen",
  companyDescription: "Rechtsträger bzw. Geschäftspartner",
  continue: "Fortfahren",
  legalDetails: "Details",
  legalDetailsDescription: "Geben Sie Ihren offiziellen Namen und Ihr Land ein. Dies wird von Stripe überprüft.",
  legalName: "Vollständiger Name",
  displayNamePlaceholder: "Wie du anderen erscheinst",
  legalNamePlaceholder: "Wie auf deinem Ausweis oder deiner Gewerbeanmeldung angegeben",
  identityNote: "Wird für die Stripe-Identitätsprüfung verwendet. Nicht öffentlich gezeigt.",
  back: "Zurück",
  reviewTerms: "Bedingungen prüfen und akzeptieren",
  reviewTermsDescription: "Lesen Sie die Bedingungen für die Nettoabrechnung sorgfältig durch. Sie müssen sie akzeptieren, um fortzufahren.",
  acceptTerms: "Ich akzeptiere diese Bedingungen",
  acceptConfirmation: "— Ich bestätige, dass ich die obigen Nettoabrechnungsbedingungen ({{version}}) gelesen und verstanden habe, einschließlich der 70/30 Umsatzaufteilung und der Test- /Simulationsmodusklausel.",
  acceptContinue: "Akzeptieren und fortfahren",
  offline: "Offline",
  stripeOnboarding: "Stripe Connect Onboarding",
  stripeDescription: "Verbinden Sie ein Stripe Express-Konto, um den Abrechnungsfluss von 70 % zu aktivieren.",
  stripeSecurity: "Bank- und Kartendaten werden von Stripe sicher gesammelt — nicht auf dieser Plattform gespeichert.",
  termsAccepted: "Akzeptierte Bedingungen ({{version}})",
  accountTypeValue: "Kontoart: {{type}}",
  openingStripe: "Stripe wird geöffnet...",
  openStripe: "Stripe-Onboarding öffnen",
  stripeRedirect: "Sie werden zu Stripe (Testmodus) weitergeleitet. Kehre hierher zurück, nachdem du ihren Ablauf abgeschlossen hast.",
  or: "oder",
  skipRedirect: "Umleitung überspringen — nur Simulations-Panels testen",
  skipDescription: "Ruft den echten Onboarding-Endpunkt auf und umgeht dann die Stripe-Umleitung, sodass Sie die 70/30-Simulations- und Auszahlungsschienen-Panels ausführen können, ohne die App zu verlassen.",
  pageTitle: "Einrichtung des Auszahlungskontos",
  pageDescription: "Richten Sie Ihr Empfängerkonto ein und überprüfen Sie den Abrechnungsfluss. Diese Beta läuft im Test- / Simulationsmodus — es wird kein echtes Geld bewegt.",
  simulationMode: "Test- / Simulationsmodus",
  simulationBanner: "Connect Onboarding- und Ledger-Zahlungen werden auf der Seite simuliert. Testzuweisungen werden nie zu Auszahlungsverpflichtungen von Stripe oder RedotPay.",
  offlineDescription: "Sie sind offline. Mutationen sind deaktiviert, bis die Verbindung wiederhergestellt ist.",
  existingAccount: "Du hast bereits ein Auszahlungskonto. Setzen Sie die Einrichtung fort oder überprüfen Sie den Status unten.",
  differentType: "Müssen Sie einen anderen Kontotyp registrieren? Weiter unten.",
  registerNew: "Neues Konto erstellen",
  setupComplete: "Die Einrichtung ist abgeschlossen",
  completeDescription: "Ihr Konto ist registriert. Verwenden Sie im Test- / Simulationsmodus die folgenden Bedienfelder, um die 70/30-Split-Logik zu üben — keine echten Geldbewegungen.",
  goWallet: "Zur Wallet gehen",
  morocco: "Marokko",
  france: "Frankreich",
  belgium: "Belgien",
  germany: "Deutschland",
  unitedKingdom: "Vereinigtes Königreich",
  unitedStates: "Vereinigte Staaten von Amerika",
  canada: "Kanada",
  unitedArabEmirates: "Vereinigte Arabische Emirate",
  termsDocument: `Nettoabrechnungsbedingungen — Arena Qaisypro (v{{version}})

1. Umsatzaufteilung
   Plattformgebühr: 30 % jeder Bruttotransaktion.
   Nettoabrechnung für den Begünstigten: 70 % jeder Bruttotransaktion.
   Diese Prozentsätze werden vor anfallenden Steuern auf den Bruttobetrag berechnet.

2. Test- / Simulationsmodus (Beta)
   Diese Version läuft im Test- / Simulationsmodus. Es wird kein echtes Geld bewegt.
   Stripe Connect verwendet ausschließlich Stripe-Testkonten. Alle angezeigten 70/30-Beträge sind simulierte Berechnungen und dienen nur der Überprüfung der Betaversion.

3. Auszahlungsabwicklung
   Auszahlungen werden über Stripe Connect Express (Livebetrieb) oder über den monatlichen manuellen RedotPay-Anfrageprozess (Begünstigte von Veranstaltungen bzw. Unternehmen) abgewickelt.
   Die Plattform erfasst, speichert oder verarbeitet lokal keine unverschlüsselten Bank- oder Kartendaten.
   Kontonummern werden serverseitig verschlüsselt; an den Client wird ausschließlich die maskierte Form übermittelt.

4. Währung und Abrechnung
   Abrechnungen erfolgen in der Währung des Auszahlungskontos. Wechselkurse werden nicht garantiert.

5. Fristen
   Auszahlungen unterliegen dem Auszahlungsplan und gegebenenfalls geltenden Sperrfristen.
   Die Plattform behält sich vor, Auszahlungen bis zum Abschluss einer Compliance- oder Betrugsprüfung zu verzögern.

6. Einschränkungen
   Auszahlungen setzen ein aktiviertes Konto und die Erfüllung aller fälligen Anforderungen voraus.

7. Haftungsausschluss bei Ausfällen von Dienstleistern
   Die Plattform haftet nicht für Verzögerungen oder Ausfälle, die durch Stripe Inc., RedotPay oder externe Banknetzwerke verursacht werden.

Mit einem Klick auf „Ich akzeptiere diese Bedingungen“ bestätigen Sie, dass Sie diese Bedingungen gelesen und verstanden haben und ihnen zustimmen.`,
};

const dictionaries: Record<Lang, Dictionary> = { en, fr, ar, es, de };

/** Supported-locale dictionaries exposed for translation parity audits. */
export const FINANCE_ONBOARDING_COPY = dictionaries;

export function onboardingT(lang: Lang, key: Key, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
    dictionaries[lang][key],
  );
}

export function financeLocale(lang: Lang): string {
  return ({ en: "en-US", fr: "fr-FR", ar: "ar-MA", es: "es-ES", de: "de-DE" } as const)[lang];
}