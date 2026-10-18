package com.example.javaivr.controller;

import com.example.javaivr.service.PythonService;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.nio.file.Files;

@RestController
public class IvrController {

    private final PythonService pythonService;

    // =========================
    // EXOTEL WEBSOCKET URL
    // =========================
    @Value("${exotel.websocket.url}")
    private String exotelWebsocketUrl;

    public IvrController(PythonService pythonService) {
        this.pythonService = pythonService;
    }


    // =========================
    // IVR WELCOME - LANGUAGE SELECTION
    // =========================
    @GetMapping(value = "/ivr/welcome", produces = "application/xml")
    public String welcome() {

        return """
            <?xml version="1.0" encoding="UTF-8"?>
            <Response>

                <Gather
                    numDigits="1"
                    action="/ivr/language"
                    method="POST">

                    <Say language="hi-IN">
                        नमस्ते। आर्थ साथी में आपका स्वागत है।
                    </Say>

                    <Say language="hi-IN">
                        हिंदी के लिए 1 दबाएं।
                    </Say>

                    <Say language="en-IN">
                        Press 2 for English.
                    </Say>

                    <Say language="hi-IN">
                        मराठीसाठी 3 दाबा।
                    </Say>

                    <Say language="hi-IN">
                        ਪੰਜਾਬੀ ਲਈ 4 ਦਬਾਓ।
                    </Say>

                </Gather>

                <Say language="hi-IN">
                    हमें कोई इनपुट नहीं मिला। धन्यवाद।
                </Say>

            </Response>
            """;
    }


    // =========================
    // LANGUAGE SELECTION
    // =========================
    @PostMapping(value = "/ivr/language", produces = "application/xml")
    public String selectLanguage(
            @RequestParam(
                    value = "Digits",
                    required = false
            )
            String digits) {

        String language = "hi-IN";
        String serviceMenuPrompt = "";

        if ("1".equals(digits)) {

            language = "hi-IN";

            serviceMenuPrompt = """
                <Say language="hi-IN">
                    सरकारी योजना के लिए 1 दबाएं।
                    बीमा के लिए 2 दबाएं।
                    दस्तावेज़ समझने के लिए 3 दबाएं।
                </Say>
                """;

        } else if ("2".equals(digits)) {

            language = "en-IN";

            serviceMenuPrompt = """
                <Say language="en-IN">
                    Press 1 for Government Schemes.
                    Press 2 for Insurance.
                    Press 3 for Document Help.
                </Say>
                """;

        } else if ("3".equals(digits)) {

            language = "mr-IN";

            serviceMenuPrompt = """
                <Say language="hi-IN">
                    सरकारी योजनांसाठी 1 दाबा।
                    विम्यासाठी 2 दाबा।
                    कागदपत्र मदतीसाठी 3 दाबा।
                </Say>
                """;

        } else if ("4".equals(digits)) {

            language = "pa-IN";

            serviceMenuPrompt = """
                <Say language="hi-IN">
                    ਸਰਕਾਰੀ ਯੋਜਨਾਵਾਂ ਲਈ 1 ਦਬਾਓ।
                    ਬੀਮੇ ਲਈ 2 ਦਬਾਓ।
                    ਦਸਤਾਵੇਜ਼ ਮਦਦ ਲਈ 3 ਦਬਾਓ।
                </Say>
                """;

        } else {

            return """
                <?xml version="1.0" encoding="UTF-8"?>
                <Response>
                    <Say language="hi-IN">
                        गलत विकल्प। कृपया दोबारा कॉल करें।
                    </Say>
                </Response>
                """;
        }

        return String.format("""
            <?xml version="1.0" encoding="UTF-8"?>
            <Response>

                <Gather
                    numDigits="1"
                    action="/ivr/menu?lang=%s"
                    method="POST">

                    %s

                </Gather>

                <Say language="%s">
                    हमें कोई इनपुट नहीं मिला।
                </Say>

            </Response>
            """, language, serviceMenuPrompt, language);
    }


    // =========================
    // IVR MENU WITH LANGUAGE SUPPORT
    // =========================
    @PostMapping(value = "/ivr/menu", produces = "application/xml")
    public String menu(
            @RequestParam(
                    value = "Digits",
                    required = false
            )
            String digits,

            @RequestParam(
                    value = "lang",
                    required = false,
                    defaultValue = "hi-IN"
            )
            String language) {

        String langCode = language.split("-")[0];


        // =========================
        // GOVERNMENT SCHEME
        // =========================
        if ("1".equals(digits)) {

            String websocketUrlWithLang =
                    exotelWebsocketUrl + "?lang=" + langCode;

            return String.format("""
                <?xml version="1.0" encoding="UTF-8"?>
                <Response>

                    <Connect>
                        <Voicebot
                            language="%s"
                            welcomeMessage="%s"
                            websocketUrl="%s"
                            endConversationMessages="धन्यवाद,अलविदा,बाय,bye,thank you,goodbye,ધન्यवाद,આભાર"
                        />
                    </Connect>

                </Response>
                """,
                    language,
                    getWelcomeMessage(langCode, "scheme"),
                    websocketUrlWithLang
            );
        }


        // =========================
        // INSURANCE
        // =========================
        if ("2".equals(digits)) {

            String websocketUrlWithLang =
                    exotelWebsocketUrl + "?lang=" + langCode;

            return String.format("""
                <?xml version="1.0" encoding="UTF-8"?>
                <Response>

                    <Connect>
                        <Voicebot
                            language="%s"
                            welcomeMessage="%s"
                            websocketUrl="%s"
                            endConversationMessages="धन्यवाद,अलविदा,बाय,bye,thank you,goodbye,धन्यवाद,આભાર"
                        />
                    </Connect>

                </Response>
                """,
                    language,
                    getWelcomeMessage(langCode, "insurance"),
                    websocketUrlWithLang
            );
        }


        // =========================
        // DOCUMENT HELP
        // =========================
        if ("3".equals(digits)) {

            String websocketUrlWithLang =
                    exotelWebsocketUrl + "?lang=" + langCode;

            return String.format("""
                <?xml version="1.0" encoding="UTF-8"?>
                <Response>

                    <Connect>
                        <Voicebot
                            language="%s"
                            welcomeMessage="%s"
                            websocketUrl="%s"
                            endConversationMessages="धन्यवाद,अलविदा,बाय,bye,thank you,goodbye,धन्यवाद,આભાર"
                        />
                    </Connect>

                </Response>
                """,
                    language,
                    getWelcomeMessage(langCode, "document"),
                    websocketUrlWithLang
            );
        }


        // =========================
        // INVALID OPTION
        // =========================
        return String.format("""
            <?xml version="1.0" encoding="UTF-8"?>
            <Response>

                <Say language="%s">
                    %s
                </Say>

            </Response>
            """,
                language,
                getErrorMessage(langCode)
        );
    }


    // =========================
    // MULTILINGUAL WELCOME MESSAGES
    // =========================
    private String getWelcomeMessage(
            String lang,
            String service) {

        return switch (lang) {

            case "hi" -> switch (service) {

                case "scheme" ->
                        "आप सरकारी योजना सेवा से जुड़े हैं। कृपया अपना सवाल बोलिए।";

                case "insurance" ->
                        "आप बीमा सेवा से जुड़े हैं। कृपया अपना सवाल बोलिए।";

                case "document" ->
                        "आप दस्तावेज़ सहायता सेवा से जुड़े हैं। कृपया अपना सवाल बोलिए।";

                default ->
                        "कृपया अपना सवाल बोलिए।";
            };


            case "en" -> switch (service) {

                case "scheme" ->
                        "You are connected to Government Schemes service. Please ask your question.";

                case "insurance" ->
                        "You are connected to Insurance service. Please ask your question.";

                case "document" ->
                        "You are connected to Document Help service. Please ask your question.";

                default ->
                        "Please ask your question.";
            };


            case "mr" -> switch (service) {

                case "scheme" ->
                        "तुम्ही सरकारी योजना सेवेशी जोडलेले आहात। कृपया तुमचा प्रश्न विचारा।";

                case "insurance" ->
                        "तुम्ही विमा सेवेशी जोडलेले आहात। कृपया तुमचा प्रश्न विचारा।";

                case "document" ->
                        "तुम्ही कागदपत्र मदत सेवेशी जोडलेले आहात। कृपया तुमचा प्रश्न विचारा।";

                default ->
                        "कृपया तुमचा प्रश्न विचारा।";
            };


            case "pa" -> switch (service) {

                case "scheme" ->
                        "ਤੁਸੀਂ ਸਰਕਾਰੀ ਯੋਜਨਾ ਸੇਵਾ ਨਾਲ ਜੁੜੇ ਹੋ। ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਸਵਾਲ ਪੁੱਛੋ।";

                case "insurance" ->
                        "ਤੁਸੀਂ ਬੀਮਾ ਸੇਵਾ ਨਾਲ ਜੁੜੇ ਹੋ। ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਸਵਾਲ ਪੁੱਛੋ।";

                case "document" ->
                        "ਤੁਸੀਂ ਦਸਤਾਵੇਜ਼ ਮਦਦ ਸੇਵਾ ਨਾਲ ਜੁੜੇ ਹੋ। ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਸਵਾਲ ਪੁੱਛੋ।";

                default ->
                        "ਕਿਰਪਾ ਕਰਕੇ ਆਪਣਾ ਸਵਾਲ ਪੁੱਛੋ।";
            };


            default ->
                    "Please ask your question.";
        };
    }


    // =========================
    // ERROR MESSAGE
    // =========================
    private String getErrorMessage(String lang) {

        return switch (lang) {

            case "hi" ->
                    "गलत विकल्प। कृपया दोबारा प्रयास करें।";

            case "en" ->
                    "Invalid option. Please try again.";

            case "mr" ->
                    "चुकीचा पर्याय। कृपया पुन्हा प्रयत्न करा।";

            case "pa" ->
                    "ਗਲਤ ਵਿਕਲਪ। ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।";

            default ->
                    "Invalid option. Please try again.";
        };
    }


    // =========================
    // USER SPEECH → PYTHON TEXT AI
    // =========================
    @PostMapping(
            value = "/ivr/speech",
            produces = "application/xml"
    )
    public String speech(
            @RequestParam(
                    value = "SpeechResult",
                    required = false
            )
            String speechResult) {

        System.out.println(
                "USER SPEECH: " + speechResult
        );


        // User ne kuch nahi bola
        if (speechResult == null ||
                speechResult.isBlank()) {

            return """
                <?xml version="1.0" encoding="UTF-8"?>
                <Response>

                    <Say language="hi-IN">
                        माफ़ कीजिए, आपकी आवाज़ समझ नहीं आई।
                        कृपया दोबारा बोलिए।
                    </Say>

                </Response>
                """;
        }


        // Java → Python text
        String aiResult =
                pythonService.sendTextToPython(
                        speechResult
                );

        System.out.println(
                "AI RESULT: " + aiResult
        );


        // Default response
        String aiResponse =
                "माफ़ कीजिए, कुछ समस्या हुई।";


        // Python JSON se response nikalna
        try {

            int start =
                    aiResult.indexOf(
                            "\"response\":\""
                    );

            if (start != -1) {

                start =
                        start +
                        "\"response\":\"".length();

                int end =
                        aiResult.indexOf(
                                "\"",
                                start
                        );

                if (end != -1) {

                    aiResponse =
                            aiResult.substring(
                                    start,
                                    end
                            );
                }
            }

        } catch (Exception e) {

            e.printStackTrace();
        }


        // XML special characters
        aiResponse =
                aiResponse
                        .replace("&", "&amp;")
                        .replace("<", "&lt;")
                        .replace(">", "&gt;")
                        .replace("\"", "&quot;");


        return """
            <?xml version="1.0" encoding="UTF-8"?>
            <Response>

                <Say language="hi-IN">
                    %s
                </Say>

            </Response>
            """.formatted(aiResponse);
    }


    // =========================
    // TEST CUSTOM SPEECH MODEL
    // =========================
    @PostMapping(
            value = "/ivr/test-speech",
            produces = "application/json"
    )
    public String testSpeech(
            @RequestParam("file")
            MultipartFile file) {

        try {

            File tempFile =
                    Files.createTempFile(
                            "ivr-test-",
                            ".wav"
                    ).toFile();

            file.transferTo(tempFile);

            String result =
                    pythonService.sendToCustomSpeechModel(
                            tempFile.getAbsolutePath()
                    );

            tempFile.delete();

            return result;

        } catch (Exception e) {

            e.printStackTrace();

            return "{\"error\":\"" +
                    e.getMessage()
                            .replace("\"", "\\\"") +
                    "\"}";
        }
    }
}