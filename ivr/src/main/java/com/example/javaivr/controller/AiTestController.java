package com.example.javaivr.controller;

import com.example.javaivr.service.PythonService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AiTestController {

    private final PythonService pythonService;

    public AiTestController(PythonService pythonService) {
        this.pythonService = pythonService;
    }

    @GetMapping("/test-ai")
    public String testAI() {

        String audioFile = "../dataset/hindi/hi_001.wav";

        return pythonService.sendToPython(audioFile);
    }
}