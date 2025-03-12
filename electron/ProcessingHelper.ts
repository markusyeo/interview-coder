// ProcessingHelper.ts
import fs from "node:fs";
import { ScreenshotHelper } from "./ScreenshotHelper";
import { IProcessingHelperDeps } from "./main";
import axios from "axios";
import { app } from "electron";
import { BrowserWindow } from "electron";

import {
  debugSolutionResponses,
  extractProblemInfo,
  generateSolutionResponses,
} from "./handlers/problemHandler";

const isDev = !app.isPackaged;

export class ProcessingHelper {
  private deps: IProcessingHelperDeps;
  private screenshotHelper: ScreenshotHelper;

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null;
  private currentExtraProcessingAbortController: AbortController | null = null;

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps;
    this.screenshotHelper = deps.getScreenshotHelper();
  }

  private async waitForInitialization(
    mainWindow: BrowserWindow
  ): Promise<void> {
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      );
      if (isInitialized) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }
    throw new Error("App failed to initialize after 5 seconds");
  }

  private async getLanguage(): Promise<string> {
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow) return "python";

    try {
      await this.waitForInitialization(mainWindow);
      const language = await mainWindow.webContents.executeJavaScript(
        "window.__LANGUAGE__"
      );

      if (
        typeof language !== "string" ||
        language === undefined ||
        language === null
      ) {
        console.warn("Language not properly initialized");
        return "python";
      }

      return language;
    } catch (error) {
      console.error("Error getting language:", error);
      return "python";
    }
  }

  private async processScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const imageDataList = screenshots.map((screenshot) => screenshot.data);
      const mainWindow = this.deps.getMainWindow();
      let problemInfo;

      // First function call - extract problem info
      try {
        problemInfo = await extractProblemInfo(imageDataList);

        // Store problem info in AppState
        this.deps.setProblemInfo(problemInfo);

        // Send first success event
        if (mainWindow) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
            problemInfo
          );
        }
      } catch (error: any) {
        if (error.message?.includes("API Key out of credits")) {
          throw new Error(error.message);
        }
        throw error; // Re-throw if not an API key error
      }

      // Second function call - generate sol  utions
      if (mainWindow) {
        const solutionsResult = await this.generateSolutionsHelper(signal);
        if (solutionsResult.success) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
            solutionsResult.data
          );
        } else {
          throw new Error(
            solutionsResult.error || "Failed to generate solutions"
          );
        }
      }

      return { success: true, data: problemInfo };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow();
    if (!mainWindow) return;

    const view = this.deps.getView();
    console.log("Processing screenshots in view:", view);

    if (view === "queue") {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START);
      const screenshotQueue = this.screenshotHelper.getScreenshotQueue();
      console.log("Processing main queue screenshots:", screenshotQueue);
      if (screenshotQueue.length === 0) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }

      try {
        // Initialize AbortController
        this.currentProcessingAbortController = new AbortController();
        const { signal } = this.currentProcessingAbortController;

        const screenshots = await Promise.all(
          screenshotQueue.map(async (path) => ({
            path,
            preview: await this.screenshotHelper.getImagePreview(path),
            data: fs.readFileSync(path).toString("base64"),
          }))
        );

        const result = await this.processScreenshotsHelper(screenshots, signal);

        if (!result.success) {
          console.log("Processing failed:", result.error);
          if (result.error?.includes("API Key out of credits")) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.API_KEY_OUT_OF_CREDITS
            );
          } else if (result.error?.includes("OpenAI API key not found")) {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              "OpenAI API key not found in environment variables. Please set the OPEN_AI_API_KEY environment variable."
            );
          } else {
            mainWindow.webContents.send(
              this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
              result.error
            );
          }
          // Reset view back to queue on error
          console.log("Resetting view to queue due to error");
          this.deps.setView("queue");
          return;
        }

        // Only set view to solutions if processing succeeded
        console.log("Setting view to solutions after successful processing");
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
          result.data
        );
        this.deps.setView("solutions");
      } catch (error: any) {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
          error
        );
        console.error("Processing error:", error);
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            "Processing was canceled by the user."
          );
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            error.message || "Server error. Please try again."
          );
        }
        // Reset view back to queue on error
        console.log("Resetting view to queue due to error");
        this.deps.setView("queue");
      } finally {
        this.currentProcessingAbortController = null;
      }
    } else {
      // view == 'solutions'
      const extraScreenshotQueue =
        this.screenshotHelper.getExtraScreenshotQueue();
      console.log("Processing extra queue screenshots:", extraScreenshotQueue);
      if (extraScreenshotQueue.length === 0) {
        mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
        return;
      }
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START);

      // Initialize AbortController
      this.currentExtraProcessingAbortController = new AbortController();
      const { signal } = this.currentExtraProcessingAbortController;

      try {
        const screenshots = await Promise.all(
          [
            ...this.screenshotHelper.getScreenshotQueue(),
            ...extraScreenshotQueue,
          ].map(async (path) => ({
            path,
            preview: await this.screenshotHelper.getImagePreview(path),
            data: fs.readFileSync(path).toString("base64"),
          }))
        );
        console.log(
          "Combined screenshots for processing:",
          screenshots.map((s) => s.path)
        );

        const result = await this.processExtraScreenshotsHelper(
          screenshots,
          signal
        );

        if (result.success) {
          this.deps.setHasDebugged(true);
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
            result.data
          );
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            result.error
          );
        }
      } catch (error: any) {
        if (axios.isCancel(error)) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            "Extra processing was canceled by the user."
          );
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
            error.message
          );
        }
      } finally {
        this.currentExtraProcessingAbortController = null;
      }
    }
  }

  private async generateSolutionsHelper(signal: AbortSignal) {
    try {
      const problemInfo = this.deps.getProblemInfo();
      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Use the generateSolutionResponses function
      const solutions = await generateSolutionResponses(problemInfo);

      if (!solutions) {
        throw new Error("No solutions received");
      }

      return { success: true, data: solutions };
    } catch (error: any) {
      const mainWindow = this.deps.getMainWindow();

      // Check if error message indicates API key out of credits
      if (error.message?.includes("API Key out of credits")) {
        if (mainWindow) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.API_KEY_OUT_OF_CREDITS
          );
        }
        return { success: false, error: error.message };
      }
      if (
        error.message?.includes(
          "Please close this window and re-enter a valid Open AI API key."
        )
      ) {
        if (mainWindow) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.API_KEY_INVALID
          );
        }
        return { success: false, error: error.message };
      }

      return { success: false, error: error.message };
    }
  }

  private async processExtraScreenshotsHelper(
    screenshots: Array<{ path: string; data: string }>,
    signal: AbortSignal
  ) {
    try {
      const imageDataList = screenshots.map((screenshot) => screenshot.data);

      const problemInfo = this.deps.getProblemInfo();
      if (!problemInfo) {
        throw new Error("No problem info available");
      }

      // Use the debugSolutionResponses function
      const debugSolutions = await debugSolutionResponses(
        imageDataList,
        problemInfo
      );

      if (!debugSolutions) {
        throw new Error("No debug solutions received");
      }

      return { success: true, data: debugSolutions };
    } catch (error: any) {
      const mainWindow = this.deps.getMainWindow();

      // Check if error message indicates API key out of credits
      if (error.message?.includes("API Key out of credits")) {
        if (mainWindow) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.API_KEY_OUT_OF_CREDITS
          );
        }
        return { success: false, error: error.message };
      }

      if (
        error.message?.includes(
          "Please close this window and re-enter a valid Open AI API key."
        )
      ) {
        if (mainWindow) {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.API_KEY_INVALID
          );
        }
        return { success: false, error: error.message };
      }
      return { success: false, error: error.message };
    }
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false;

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort();
      this.currentProcessingAbortController = null;
      wasCancelled = true;
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort();
      this.currentExtraProcessingAbortController = null;
      wasCancelled = true;
    }

    // Reset hasDebugged flag
    this.deps.setHasDebugged(false);

    // Clear any pending state
    this.deps.setProblemInfo(null);

    const mainWindow = this.deps.getMainWindow();
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      // Send a clear message that processing was cancelled
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS);
    }
  }
}
