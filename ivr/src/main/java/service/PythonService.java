package com.example.javaivr.service;

import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

@Service
public class PythonService {

    // =========================
    // JAVA → PYTHON AUDIO
    // =========================
    public String sendToPython(String audioFile) {
        try {
            URL url = new URL("http://127.0.0.1:8000/ai");

            HttpURLConnection connection =
                    (HttpURLConnection) url.openConnection();

            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty(
                    "Content-Type",
                    "application/json"
            );

            String json =
                    "{\"audio_file\":\"" +
                    audioFile.replace("\\", "\\\\") +
                    "\"}";

            byte[] input =
                    json.getBytes(StandardCharsets.UTF_8);

            connection.setFixedLengthStreamingMode(input.length);

            try (OutputStream outputStream =
                         connection.getOutputStream()) {
                outputStream.write(input);
            }

            int responseCode =
                    connection.getResponseCode();

            BufferedReader reader =
                    new BufferedReader(
                            new InputStreamReader(
                                    connection.getInputStream(),
                                    StandardCharsets.UTF_8
                            )
                    );

            StringBuilder response =
                    new StringBuilder();

            String line;

            while ((line = reader.readLine()) != null) {
                response.append(line);
            }

            reader.close();
            connection.disconnect();

            System.out.println(
                    "Python response code: " + responseCode
            );

            System.out.println(
                    "Python response: " + response
            );

            return response.toString();

        } catch (Exception e) {
            e.printStackTrace();

            return "Error connecting to Python: "
                    + e.getMessage();
        }
    }


    // =========================
    // JAVA → PYTHON TEXT
    // =========================
    public String sendTextToPython(String text) {
        try {
            URL url =
                    new URL("http://127.0.0.1:8000/text");

            HttpURLConnection connection =
                    (HttpURLConnection) url.openConnection();

            connection.setRequestMethod("POST");
            connection.setDoOutput(true);

            connection.setRequestProperty(
                    "Content-Type",
                    "application/json; charset=UTF-8"
            );

            String safeText = text
                    .replace("\\", "\\\\")
                    .replace("\"", "\\\"");

            String json =
                    "{\"text\":\"" + safeText + "\"}";

            byte[] input =
                    json.getBytes(StandardCharsets.UTF_8);

            connection.setFixedLengthStreamingMode(input.length);

            try (OutputStream outputStream =
                         connection.getOutputStream()) {
                outputStream.write(input);
            }

            int responseCode =
                    connection.getResponseCode();

            BufferedReader reader =
                    new BufferedReader(
                            new InputStreamReader(
                                    connection.getInputStream(),
                                    StandardCharsets.UTF_8
                            )
                    );

            StringBuilder response =
                    new StringBuilder();

            String line;

            while ((line = reader.readLine()) != null) {
                response.append(line);
            }

            reader.close();
            connection.disconnect();

            System.out.println(
                    "Python text response code: "
                    + responseCode
            );

            System.out.println(
                    "Python text response: "
                    + response
            );

            return response.toString();

        } catch (Exception e) {
            e.printStackTrace();

            return "Error connecting to Python: "
                    + e.getMessage();
        }
    }


    // =========================
    // JAVA → CUSTOM SPEECH MODEL
    // =========================
    public String sendToCustomSpeechModel(String audioFile) {

        String boundary =
                "----JavaBoundary" +
                System.currentTimeMillis();

        try {

            URL url =
                    new URL("http://127.0.0.1:8002/predict");

            HttpURLConnection connection =
                    (HttpURLConnection) url.openConnection();

            connection.setRequestMethod("POST");
            connection.setDoOutput(true);

            connection.setRequestProperty(
                    "Content-Type",
                    "multipart/form-data; boundary=" + boundary
            );

            File file = new File(audioFile);

            try (
                    OutputStream output =
                            connection.getOutputStream();

                    FileInputStream input =
                            new FileInputStream(file)
            ) {

                String header =
                        "--" + boundary + "\r\n" +
                        "Content-Disposition: form-data; " +
                        "name=\"file\"; filename=\"" +
                        file.getName() + "\"\r\n" +
                        "Content-Type: audio/wav\r\n\r\n";

                output.write(
                        header.getBytes(StandardCharsets.UTF_8)
                );

                byte[] buffer = new byte[4096];

                int bytesRead;

                while ((bytesRead = input.read(buffer)) != -1) {
                    output.write(buffer, 0, bytesRead);
                }

                output.write(
                        ("\r\n--" +
                         boundary +
                         "--\r\n")
                                .getBytes(StandardCharsets.UTF_8)
                );
            }

            int responseCode =
                    connection.getResponseCode();

            BufferedReader reader =
                    new BufferedReader(
                            new InputStreamReader(
                                    connection.getInputStream(),
                                    StandardCharsets.UTF_8
                            )
                    );

            StringBuilder response =
                    new StringBuilder();

            String line;

            while ((line = reader.readLine()) != null) {
                response.append(line);
            }

            reader.close();
            connection.disconnect();

            System.out.println(
                    "Custom Speech Model response code: "
                    + responseCode
            );

            System.out.println(
                    "Custom Speech Model response: "
                    + response
            );

            return response.toString();

        } catch (Exception e) {

            e.printStackTrace();

            return "Error connecting to Custom Speech Model: "
                    + e.getMessage();
        }
    }
}