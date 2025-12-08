import { CaptchaSolver } from "@/typings/index.js";
import axios, { AxiosInstance } from "axios";

// --- Type Definitions ---
type ImageToTextTask = {
    type: "ImageToTextTaskMuggle" | "ImageToTextTaskM1";
    body: string; // Base64 encoded image data
};

type HCaptchaTask = {
    type: "HCaptchaTaskProxyless";
    websiteURL: string;
    websiteKey: string;
    userAgent?: string;
    isInvisible?: boolean;
    rqdata?: string;
};

type TaskCreatedResponse = {
    errorId: 0 | 1;
    errorCode?: string;
    errorDescription?: string;
    taskId: string;
};

type ImageToTextResponse = {
    errorId: 0 | 1;
    errorCode?: string;
    errorDescription?: string;
    solution: {
        text: string;
    };
};

type TaskResultResponse = {
    errorId: 0 | 1;
    errorCode?: string;
    errorDescription?: string;
    status: "ready" | "processing";
    solution?: {
        gRecaptchaResponse: string;
        userAgent: string;
        respKey?: string;
    };
};

// --- Helper Function ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Class Implementation ---
export class YesCaptchaSolver implements CaptchaSolver {
    private axiosInstance: AxiosInstance;

    constructor(private apiKey: string) {
        this.axiosInstance = axios.create({
            baseURL: "https://api.yescaptcha.com",
            headers: { "User-Agent": "YesCaptcha-Node-Client" },
            validateStatus: () => true, // Handle all status codes in the response
        });
    }

    // Overloaded method to create different captcha tasks
    public createTask(options: ImageToTextTask): Promise<{ data: ImageToTextResponse }>;
    public createTask(options: HCaptchaTask): Promise<{ data: TaskCreatedResponse }>;
    public createTask(options: ImageToTextTask | HCaptchaTask): Promise<{ data: ImageToTextResponse | TaskCreatedResponse }> {
        return this.axiosInstance.post("/createTask", {
            clientKey: this.apiKey,
            task: options,
        });
    }

    private async pollTaskResult(taskId: string): Promise<TaskResultResponse> {
        while (true) {
            await delay(3000); // Wait 3 seconds between polls
            const response = await this.axiosInstance.post<TaskResultResponse>("/getTaskResult", {
                clientKey: this.apiKey,
                taskId: taskId,
            });

            if (response.data.status === "ready") {
                return response.data;
            }
            // Continue polling if status is "processing"
        }
    }

    public async solveImage(imageData: Buffer): Promise<string> {
        const { data } = await this.createTask({
            type: "ImageToTextTaskM1",
            body: imageData.toString("base64"),
        });

        if (data.errorId !== 0) {
            throw new Error(`[YesCaptcha] Image-to-text task failed: ${data.errorDescription}`);
        }
        return data.solution.text;
    }

    public async solveHcaptcha(sitekey: string, siteurl: string): Promise<string> {
        const { data: createTaskData } = await this.createTask({
            type: "HCaptchaTaskProxyless",
            websiteKey: sitekey,
            websiteURL: siteurl,
        });

        // --- XỬ LÝ LỖI THÔNG MINH (SMART RETRY) ---
        if (createTaskData.errorId !== 0) {
            const errDesc = createTaskData.errorDescription || "";
            
            // Kiểm tra lỗi bị chặn 5 phút (tiếng Trung hoặc tiếng Anh)
            if (errDesc.includes("过多错误请求") || errDesc.includes("excessive erroneous requests")) {
                console.warn(`\n[YesCaptcha] ⚠️ Bị chặn tạm thời (Rate Limit). Đang ngủ 5 phút 10 giây để mở khóa...`);
                
                // Chờ 310 giây (5 phút + 10s dự phòng)
                await delay(310 * 1000);
                
                console.log(`[YesCaptcha] ♻️ Hết thời gian chờ, đang tự động thử lại...`);
                
                // Gọi lại chính hàm này (Đệ quy) để thử lại
                return this.solveHcaptcha(sitekey, siteurl);
            }

            // Nếu là lỗi khác thì throw như bình thường
            throw new Error(`[YesCaptcha] HCaptcha task creation failed: ${createTaskData.errorDescription}`);
        }
        // ------------------------------------------

        const resultData = await this.pollTaskResult(createTaskData.taskId);

        if (resultData.errorId !== 0 || !resultData.solution) {
            throw new Error(`[YesCaptcha] HCaptcha solution failed: ${resultData.errorDescription}`);
        }

        return resultData.solution.gRecaptchaResponse;
    }
}
