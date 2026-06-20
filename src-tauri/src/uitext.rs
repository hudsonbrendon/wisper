//! Minimal interface-language strings for the parts of the UI built in Rust:
//! the native tray menu and the error toasts emitted from the backend. The web
//! UI has its own (larger) i18n; this only covers what the frontend can't reach.
//! Look-ups fall back to English for any missing language or key.
//!
//! Each language is one flat `(key, value)` slice so adding a locale is a single
//! const + one match arm.

type Dict = &'static [(&'static str, &'static str)];

const EN: Dict = &[
    ("tray_home", "Home"),
    ("tray_updates", "Check for Updates"),
    ("tray_paste", "Paste Last Transcription"),
    ("tray_microphone", "Microphone"),
    ("tray_system_default", "System Default"),
    ("tray_quit", "Quit Wisp"),
    ("err_no_audio", "No audio captured — hold the hotkey while you speak."),
    ("err_no_mic_mac", "No audio detected — grant Wisp's Microphone permission in System Settings → Privacy & Security → Microphone, then try again."),
    ("err_no_mic_win", "No audio detected — allow microphone access in Settings → Privacy & security → Microphone (turn on \"Let desktop apps access your microphone\"), then try again."),
    ("err_no_mic_linux", "No audio detected — check that your microphone is connected and not muted, then try again."),
    ("err_no_model", "No model loaded — download one in Settings."),
    ("err_no_transcription", "No transcription yet."),
    ("err_accessibility", "Grant Accessibility permission to Wisp (System Settings → Privacy & Security → Accessibility). If Wisp is already listed and enabled, toggle it off and on — the previous build's permission goes stale after an update."),
];

const PT: Dict = &[
    ("tray_home", "Início"),
    ("tray_updates", "Verificar atualizações"),
    ("tray_paste", "Colar última transcrição"),
    ("tray_microphone", "Microfone"),
    ("tray_system_default", "Padrão do sistema"),
    ("tray_quit", "Sair do Wisp"),
    ("err_no_audio", "Nenhum áudio captado — segure o atalho enquanto fala."),
    ("err_no_mic_mac", "Nenhum áudio detectado — conceda a permissão de Microfone ao Wisp em Ajustes do Sistema → Privacidade e Segurança → Microfone, e tente de novo."),
    ("err_no_mic_win", "Nenhum áudio detectado — permita o acesso ao microfone em Configurações → Privacidade e segurança → Microfone (ative \"Permitir que apps da área de trabalho acessem o microfone\"), e tente de novo."),
    ("err_no_mic_linux", "Nenhum áudio detectado — verifique se o microfone está conectado e não está mudo, e tente de novo."),
    ("err_no_model", "Nenhum modelo carregado — baixe um nas Configurações."),
    ("err_no_transcription", "Nenhuma transcrição ainda."),
    ("err_accessibility", "Conceda a permissão de Acessibilidade ao Wisp (Ajustes do Sistema → Privacidade e Segurança → Acessibilidade). Se o Wisp já estiver listado e ativado, desligue e ligue de novo — a permissão da versão anterior fica obsoleta após uma atualização."),
];

const ES: Dict = &[
    ("tray_home", "Inicio"),
    ("tray_updates", "Buscar actualizaciones"),
    ("tray_paste", "Pegar última transcripción"),
    ("tray_microphone", "Micrófono"),
    ("tray_system_default", "Predeterminado del sistema"),
    ("tray_quit", "Salir de Wisp"),
    ("err_no_audio", "No se capturó audio — mantén pulsada la tecla de acceso rápido mientras hablas."),
    ("err_no_mic_mac", "No se detectó audio — concede el permiso de Micrófono a Wisp en Ajustes del Sistema → Privacidad y seguridad → Micrófono y vuelve a intentarlo."),
    ("err_no_mic_win", "No se detectó audio — permite el acceso al micrófono en Configuración → Privacidad y seguridad → Micrófono (activa \"Permitir que las aplicaciones de escritorio accedan al micrófono\") y vuelve a intentarlo."),
    ("err_no_mic_linux", "No se detectó audio — comprueba que el micrófono esté conectado y sin silencio, y vuelve a intentarlo."),
    ("err_no_model", "No hay ningún modelo cargado — descarga uno en Configuración."),
    ("err_no_transcription", "Aún no hay transcripción."),
    ("err_accessibility", "Concede el permiso de Accesibilidad a Wisp (Ajustes del Sistema → Privacidad y seguridad → Accesibilidad). Si Wisp ya aparece en la lista y está habilitado, desactívalo y vuelve a activarlo — el permiso de la compilación anterior caduca tras una actualización."),
];
const FR: Dict = &[
    ("tray_home", "Accueil"),
    ("tray_updates", "Rechercher des mises à jour"),
    ("tray_paste", "Coller la dernière transcription"),
    ("tray_microphone", "Microphone"),
    ("tray_system_default", "Par défaut du système"),
    ("tray_quit", "Quitter Wisp"),
    ("err_no_audio", "Aucun audio capturé — maintenez le raccourci enfoncé pendant que vous parlez."),
    ("err_no_mic_mac", "Aucun audio détecté — accordez l'autorisation Microphone à Wisp dans Réglages Système → Confidentialité et sécurité → Microphone, puis réessayez."),
    ("err_no_mic_win", "Aucun audio détecté — autorisez l'accès au microphone dans Paramètres → Confidentialité et sécurité → Microphone (activez \"Autoriser les applications de bureau à accéder à votre microphone\"), puis réessayez."),
    ("err_no_mic_linux", "Aucun audio détecté — vérifiez que votre microphone est connecté et non mis en sourdine, puis réessayez."),
    ("err_no_model", "Aucun modèle chargé — téléchargez-en un dans les Paramètres."),
    ("err_no_transcription", "Aucune transcription pour l'instant."),
    ("err_accessibility", "Accordez l'autorisation Accessibilité à Wisp (Réglages Système → Confidentialité et sécurité → Accessibilité). Si Wisp est déjà dans la liste et activé, désactivez-le puis réactivez-le — l'autorisation de la version précédente devient obsolète après une mise à jour."),
];
const IT: Dict = &[
    ("tray_home", "Home"),
    ("tray_updates", "Verifica aggiornamenti"),
    ("tray_paste", "Incolla l'ultima trascrizione"),
    ("tray_microphone", "Microfono"),
    ("tray_system_default", "Predefinito di sistema"),
    ("tray_quit", "Esci da Wisp"),
    ("err_no_audio", "Nessun audio acquisito — tieni premuto il tasto di scelta rapida mentre parli."),
    ("err_no_mic_mac", "Nessun audio rilevato — concedi il permesso Microfono a Wisp in Impostazioni di Sistema → Privacy e sicurezza → Microfono, quindi riprova."),
    ("err_no_mic_win", "Nessun audio rilevato — consenti l'accesso al microfono in Impostazioni → Privacy e sicurezza → Microfono (attiva \"Consenti alle app desktop di accedere al microfono\"), quindi riprova."),
    ("err_no_mic_linux", "Nessun audio rilevato — verifica che il microfono sia collegato e non disattivato, quindi riprova."),
    ("err_no_model", "Nessun modello caricato — scaricane uno nelle Impostazioni."),
    ("err_no_transcription", "Nessuna trascrizione ancora."),
    ("err_accessibility", "Concedi il permesso Accessibilità a Wisp (Impostazioni di Sistema → Privacy e sicurezza → Accessibilità). Se Wisp è già nell'elenco e abilitato, disabilitalo e riabilitalo — il permesso della versione precedente diventa obsoleto dopo un aggiornamento."),
];
const DE: Dict = &[
    ("tray_home", "Startseite"),
    ("tray_updates", "Nach Updates suchen"),
    ("tray_paste", "Letzte Transkription einfügen"),
    ("tray_microphone", "Mikrofon"),
    ("tray_system_default", "Systemstandard"),
    ("tray_quit", "Wisp beenden"),
    ("err_no_audio", "Kein Audio aufgenommen — halte den Hotkey gedrückt, während du sprichst."),
    ("err_no_mic_mac", "Kein Audio erkannt — erteile Wisp die Mikrofonberechtigung unter Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon und versuche es erneut."),
    ("err_no_mic_win", "Kein Audio erkannt — erlaube den Mikrofonzugriff unter Einstellungen → Datenschutz & Sicherheit → Mikrofon (aktiviere \"Desktop-Apps Zugriff auf dein Mikrofon erlauben\") und versuche es erneut."),
    ("err_no_mic_linux", "Kein Audio erkannt — stelle sicher, dass dein Mikrofon angeschlossen und nicht stummgeschaltet ist, und versuche es erneut."),
    ("err_no_model", "Kein Modell geladen — lade eines in den Einstellungen herunter."),
    ("err_no_transcription", "Noch keine Transkription vorhanden."),
    ("err_accessibility", "Erteile Wisp die Bedienungshilfenberechtigung (Systemeinstellungen → Datenschutz & Sicherheit → Bedienungshilfen). Wenn Wisp dort bereits aktiviert ist, deaktiviere und reaktiviere es — die Berechtigung des vorherigen Builds wird nach einem Update ungültig."),
];
const NL: Dict = &[
    ("tray_home", "Startscherm"),
    ("tray_updates", "Controleer op updates"),
    ("tray_paste", "Laatste transcriptie plakken"),
    ("tray_microphone", "Microfoon"),
    ("tray_system_default", "Systeemstandaard"),
    ("tray_quit", "Wisp afsluiten"),
    ("err_no_audio", "Geen audio opgenomen — houd de sneltoets ingedrukt terwijl je spreekt."),
    ("err_no_mic_mac", "Geen audio gedetecteerd — geef Wisp toestemming voor de microfoon via Systeeminstellingen → Privacy en beveiliging → Microfoon en probeer het opnieuw."),
    ("err_no_mic_win", "Geen audio gedetecteerd — sta microfoontoegang toe via Instellingen → Privacy en beveiliging → Microfoon (schakel \"Bureaublad-apps toegang geven tot je microfoon\" in) en probeer het opnieuw."),
    ("err_no_mic_linux", "Geen audio gedetecteerd — controleer of je microfoon is aangesloten en niet gedempt is, en probeer het opnieuw."),
    ("err_no_model", "Geen model geladen — download er een via Instellingen."),
    ("err_no_transcription", "Nog geen transcriptie beschikbaar."),
    ("err_accessibility", "Geef Wisp toegangsbeheer-toestemming (Systeeminstellingen → Privacy en beveiliging → Toegankelijkheid). Als Wisp al in de lijst staat en is ingeschakeld, schakel het dan uit en weer in — de toestemming van een vorige versie verloopt na een update."),
];
const PL: Dict = &[
    ("tray_home", "Strona główna"),
    ("tray_updates", "Sprawdź aktualizacje"),
    ("tray_paste", "Wklej ostatnią transkrypcję"),
    ("tray_microphone", "Mikrofon"),
    ("tray_system_default", "Domyślny systemowy"),
    ("tray_quit", "Zamknij Wisp"),
    ("err_no_audio", "Nie zarejestrowano dźwięku — przytrzymaj skrót klawiszowy podczas mówienia."),
    ("err_no_mic_mac", "Nie wykryto dźwięku — przyznaj Wisp dostęp do mikrofonu w Ustawienia systemowe → Prywatność i bezpieczeństwo → Mikrofon, a następnie spróbuj ponownie."),
    ("err_no_mic_win", "Nie wykryto dźwięku — zezwól na dostęp do mikrofonu w Ustawienia → Prywatność i bezpieczeństwo → Mikrofon (włącz opcję \"Zezwalaj aplikacjom klasycznym na dostęp do mikrofonu\"), a następnie spróbuj ponownie."),
    ("err_no_mic_linux", "Nie wykryto dźwięku — sprawdź, czy mikrofon jest podłączony i nie jest wyciszony, a następnie spróbuj ponownie."),
    ("err_no_model", "Nie załadowano modelu — pobierz jeden w Ustawieniach."),
    ("err_no_transcription", "Brak transkrypcji."),
    ("err_accessibility", "Przyznaj Wisp uprawnienie dostępu ułatwień dostępu (Ustawienia systemowe → Prywatność i bezpieczeństwo → Dostępność). Jeśli Wisp jest już na liście i włączony, wyłącz go i włącz ponownie — uprawnienie poprzedniej wersji wygasa po aktualizacji."),
];
const RU: Dict = &[
    ("tray_home", "Главная"),
    ("tray_updates", "Проверить обновления"),
    ("tray_paste", "Вставить последнюю расшифровку"),
    ("tray_microphone", "Микрофон"),
    ("tray_system_default", "По умолчанию"),
    ("tray_quit", "Выйти из Wisp"),
    ("err_no_audio", "Аудио не записано — удерживайте горячую клавишу во время речи."),
    ("err_no_mic_mac", "Аудио не обнаружено — разрешите Wisp доступ к микрофону в «Системных настройках» → «Конфиденциальность и безопасность» → «Микрофон», затем повторите попытку."),
    ("err_no_mic_win", "Аудио не обнаружено — разрешите доступ к микрофону в «Параметрах» → «Конфиденциальность и безопасность» → «Микрофон» (включите параметр «Разрешить классическим приложениям доступ к микрофону»), затем повторите попытку."),
    ("err_no_mic_linux", "Аудио не обнаружено — убедитесь, что микрофон подключён и не отключён, затем повторите попытку."),
    ("err_no_model", "Модель не загружена — скачайте её в настройках."),
    ("err_no_transcription", "Расшифровка ещё не выполнена."),
    ("err_accessibility", "Предоставьте Wisp разрешение на доступ к специальным возможностям («Системные настройки» → «Конфиденциальность и безопасность» → «Универсальный доступ»). Если Wisp уже есть в списке и включён, снимите и снова установите флажок — разрешение предыдущей версии устаревает после обновления."),
];
const TR: Dict = &[
    ("tray_home", "Ana Sayfa"),
    ("tray_updates", "Güncellemeleri Denetle"),
    ("tray_paste", "Son Dönüşümü Yapıştır"),
    ("tray_microphone", "Mikrofon"),
    ("tray_system_default", "Sistem Varsayılanı"),
    ("tray_quit", "Wisp'dan Çık"),
    ("err_no_audio", "Ses kaydedilemedi — konuşurken kısayol tuşunu basılı tutun."),
    ("err_no_mic_mac", "Ses algılanamadı — Wisp için Sistem Ayarları → Gizlilik ve Güvenlik → Mikrofon yolundan mikrofon iznini verin, ardından tekrar deneyin."),
    ("err_no_mic_win", "Ses algılanamadı — Ayarlar → Gizlilik ve güvenlik → Mikrofon yolundan mikrofon erişimine izin verin (\"Masaüstü uygulamalarının mikrofonunuza erişmesine izin ver\" seçeneğini açın), ardından tekrar deneyin."),
    ("err_no_mic_linux", "Ses algılanamadı — mikrofonun bağlı ve sesinin açık olduğundan emin olun, ardından tekrar deneyin."),
    ("err_no_model", "Model yüklenmedi — Ayarlar'dan bir model indirin."),
    ("err_no_transcription", "Henüz transkripsiyon yok."),
    ("err_accessibility", "Wisp'a Erişilebilirlik izni verin (Sistem Ayarları → Gizlilik ve Güvenlik → Erişilebilirlik). Wisp zaten listede ve etkinse, izni kapatıp yeniden açın — önceki sürümün izni güncelleme sonrasında geçersiz hale gelir."),
];
const AR: Dict = &[
    ("tray_home", "الرئيسية"),
    ("tray_updates", "التحقق من التحديثات"),
    ("tray_paste", "لصق آخر نص مُحوَّل"),
    ("tray_microphone", "الميكروفون"),
    ("tray_system_default", "الإعداد الافتراضي للنظام"),
    ("tray_quit", "إنهاء Wisp"),
    ("err_no_audio", "لم يُسجَّل أي صوت — اضغط مع الاستمرار على المفتاح المختصر أثناء حديثك."),
    ("err_no_mic_mac", "لم يُكتشَف أي صوت — امنح Wisp إذن الوصول إلى الميكروفون من إعدادات النظام → الخصوصية والأمان → الميكروفون، ثم حاول مجدداً."),
    ("err_no_mic_win", "لم يُكتشَف أي صوت — اسمح بالوصول إلى الميكروفون من الإعدادات → الخصوصية والأمان → الميكروفون (فعّل خيار \"السماح لتطبيقات سطح المكتب بالوصول إلى الميكروفون\")، ثم حاول مجدداً."),
    ("err_no_mic_linux", "لم يُكتشَف أي صوت — تأكد من توصيل الميكروفون وعدم كتم صوته، ثم حاول مجدداً."),
    ("err_no_model", "لم يُحمَّل أي نموذج — قم بتنزيل نموذج من الإعدادات."),
    ("err_no_transcription", "لا يوجد نص مُحوَّل بعد."),
    ("err_accessibility", "امنح Wisp إذن الوصول إلى الإمكانية (إعدادات النظام → الخصوصية والأمان → الإمكانية). إذا كان Wisp مدرجاً ومُفعَّلاً بالفعل، فأوقف تشغيله ثم أعد تفعيله — إذ يصبح إذن الإصدار السابق غير صالح بعد التحديث."),
];
const JA: Dict = &[
    ("tray_home", "ホーム"),
    ("tray_updates", "アップデートを確認"),
    ("tray_paste", "最後の文字起こしを貼り付け"),
    ("tray_microphone", "マイク"),
    ("tray_system_default", "システムデフォルト"),
    ("tray_quit", "Wisp を終了"),
    ("err_no_audio", "音声が録音されませんでした — ホットキーを押しながら話してください。"),
    ("err_no_mic_mac", "音声が検出されませんでした — システム設定 → プライバシーとセキュリティ → マイク で Wisp にマイクのアクセス許可を付与してから、もう一度お試しください。"),
    ("err_no_mic_win", "音声が検出されませんでした — 設定 → プライバシーとセキュリティ → マイク でマイクのアクセスを許可し（「デスクトップ アプリがマイクにアクセスできるようにする」をオンにする）、もう一度お試しください。"),
    ("err_no_mic_linux", "音声が検出されませんでした — マイクが接続されており、ミュートになっていないことを確認してから、もう一度お試しください。"),
    ("err_no_model", "モデルが読み込まれていません — 設定からダウンロードしてください。"),
    ("err_no_transcription", "まだ文字起こしはありません。"),
    ("err_accessibility", "Wisp にアクセシビリティの許可を付与してください（システム設定 → プライバシーとセキュリティ → アクセシビリティ）。すでにリストに表示されて有効になっている場合は、一度オフにしてからオンに切り替えてください — アップデート後は以前のビルドのアクセス許可が無効になります。"),
];
const KO: Dict = &[
    ("tray_home", "홈"),
    ("tray_updates", "업데이트 확인"),
    ("tray_paste", "마지막 전사 내용 붙여넣기"),
    ("tray_microphone", "마이크"),
    ("tray_system_default", "시스템 기본값"),
    ("tray_quit", "Wisp 종료"),
    ("err_no_audio", "오디오가 녹음되지 않았습니다 — 말하는 동안 단축키를 누르고 계세요."),
    ("err_no_mic_mac", "오디오가 감지되지 않았습니다 — 시스템 설정 → 개인 정보 보호 및 보안 → 마이크 에서 Wisp의 마이크 권한을 허용한 후 다시 시도하세요."),
    ("err_no_mic_win", "오디오가 감지되지 않았습니다 — 설정 → 개인 정보 및 보안 → 마이크 에서 마이크 액세스를 허용하고（\"데스크톱 앱이 마이크에 액세스하도록 허용\"을 켜세요）, 다시 시도하세요."),
    ("err_no_mic_linux", "오디오가 감지되지 않았습니다 — 마이크가 연결되어 있고 음소거 상태가 아닌지 확인한 후 다시 시도하세요."),
    ("err_no_model", "로드된 모델이 없습니다 — 설정에서 다운로드하세요."),
    ("err_no_transcription", "아직 전사 내용이 없습니다."),
    ("err_accessibility", "Wisp에 손쉬운 사용 권한을 부여하세요（시스템 설정 → 개인 정보 보호 및 보안 → 손쉬운 사용）. Wisp이 이미 목록에 있고 활성화되어 있다면 껐다가 다시 켜세요 — 업데이트 후에는 이전 빌드의 권한이 만료됩니다."),
];
const ZH: Dict = &[
    ("tray_home", "主页"),
    ("tray_updates", "检查更新"),
    ("tray_paste", "粘贴最后一次转录内容"),
    ("tray_microphone", "麦克风"),
    ("tray_system_default", "系统默认"),
    ("tray_quit", "退出 Wisp"),
    ("err_no_audio", "未录制到音频 — 请在说话时按住快捷键。"),
    ("err_no_mic_mac", "未检测到音频 — 请在系统设置 → 隐私与安全性 → 麦克风 中授予 Wisp 麦克风权限，然后重试。"),
    ("err_no_mic_win", "未检测到音频 — 请在设置 → 隐私和安全性 → 麦克风 中允许麦克风访问（开启\"允许桌面应用访问你的麦克风\"），然后重试。"),
    ("err_no_mic_linux", "未检测到音频 — 请确认麦克风已连接且未静音，然后重试。"),
    ("err_no_model", "未加载模型 — 请在设置中下载一个。"),
    ("err_no_transcription", "暂无转录内容。"),
    ("err_accessibility", "请授予 Wisp 辅助功能权限（系统设置 → 隐私与安全性 → 辅助功能）。如果 Wisp 已在列表中并已启用，请先关闭再重新开启 — 更新后旧版本的权限会失效。"),
];
const HI: Dict = &[
    ("tray_home", "होम"),
    ("tray_updates", "अपडेट जांचें"),
    ("tray_paste", "अंतिम ट्रांसक्रिप्शन पेस्ट करें"),
    ("tray_microphone", "माइक्रोफ़ोन"),
    ("tray_system_default", "सिस्टम डिफ़ॉल्ट"),
    ("tray_quit", "Wisp बंद करें"),
    ("err_no_audio", "कोई ऑडियो रिकॉर्ड नहीं हुआ — बोलते समय हॉटकी दबाए रखें।"),
    ("err_no_mic_mac", "कोई ऑडियो नहीं मिला — सिस्टम सेटिंग्स → गोपनीयता और सुरक्षा → माइक्रोफ़ोन में Wisp को माइक्रोफ़ोन की अनुमति दें, फिर दोबारा प्रयास करें।"),
    ("err_no_mic_win", "कोई ऑडियो नहीं मिला — सेटिंग्स → गोपनीयता और सुरक्षा → माइक्रोफ़ोन में माइक्रोफ़ोन एक्सेस की अनुमति दें (\"डेस्कटॉप ऐप्स को आपके माइक्रोफ़ोन तक पहुंचने दें\" चालू करें), फिर दोबारा प्रयास करें।"),
    ("err_no_mic_linux", "कोई ऑडियो नहीं मिला — सुनिश्चित करें कि माइक्रोफ़ोन जुड़ा है और म्यूट नहीं है, फिर दोबारा प्रयास करें।"),
    ("err_no_model", "कोई मॉडल लोड नहीं है — सेटिंग्स में से एक डाउनलोड करें।"),
    ("err_no_transcription", "अभी तक कोई ट्रांसक्रिप्शन नहीं।"),
    ("err_accessibility", "Wisp को एक्सेसिबिलिटी की अनुमति दें (सिस्टम सेटिंग्स → गोपनीयता और सुरक्षा → एक्सेसिबिलिटी)। अगर Wisp पहले से सूची में है और सक्षम है, तो उसे बंद करके फिर चालू करें — अपडेट के बाद पुराने बिल्ड की अनुमति अमान्य हो जाती है।"),
];

/// The dictionary for a language code (its primary subtag), English if unknown.
fn dict(lang: &str) -> Dict {
    match lang.split(['-', '_']).next().unwrap_or("en") {
        "pt" => PT,
        "es" => ES,
        "fr" => FR,
        "it" => IT,
        "de" => DE,
        "nl" => NL,
        "pl" => PL,
        "ru" => RU,
        "tr" => TR,
        "ar" => AR,
        "ja" => JA,
        "ko" => KO,
        "zh" => ZH,
        "hi" => HI,
        _ => EN,
    }
}

/// All supported UI language codes (for the coverage test).
#[cfg(test)]
const ALL_LANGS: &[&str] = &[
    "pt", "es", "fr", "it", "de", "nl", "pl", "ru", "tr", "ar", "ja", "ko", "zh", "hi",
];

/// Translate `key` for `lang`, falling back to English then to the key itself.
pub fn t(lang: &str, key: &str) -> String {
    let find = |d: Dict| d.iter().find(|(k, _)| *k == key).map(|(_, v)| *v);
    find(dict(lang))
        .or_else(|| find(EN))
        .map(|s| s.to_string())
        .unwrap_or_else(|| key.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_known_key() {
        assert_eq!(t("pt", "tray_home"), "Início");
        assert_eq!(t("en", "tray_home"), "Home");
    }

    #[test]
    fn falls_back_to_english_for_unknown_lang() {
        assert_eq!(t("xx", "tray_quit"), "Quit Wisp");
    }

    #[test]
    fn primary_subtag_is_used() {
        assert_eq!(t("pt-BR", "tray_microphone"), "Microfone");
    }

    #[test]
    fn unknown_key_returns_key() {
        assert_eq!(t("pt", "nope"), "nope");
    }

    #[test]
    fn every_language_covers_all_english_keys() {
        for (key, _) in EN {
            for lang in ALL_LANGS {
                assert!(
                    dict(lang).iter().any(|(k, _)| k == key),
                    "{lang} missing key {key}"
                );
            }
        }
    }
}
