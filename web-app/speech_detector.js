import { ReadableStream } from "node:stream/web";
import { Silero } from "./silero.js";
class SpeechDetector {
    silero;
    frameSamples;
    positiveSpeechThreshold;
    negativeSpeechThreshold;
    redemptionFrames;
    minSpeechFrames;
    speechSegmentsStreamController = null;
    currentSpeechSegment = null;
    speaking = false;
    redemptionCounter = 0;
    speechFrameCount = 0;
    frameCount = 0;
    constructor(silero, frameSamples, positiveSpeechThreshold, negativeSpeechThreshold, redemptionFrames, minSpeechFrames) {
        this.silero = silero;
        this.frameSamples = frameSamples;
        this.positiveSpeechThreshold = positiveSpeechThreshold;
        this.negativeSpeechThreshold = negativeSpeechThreshold;
        this.redemptionFrames = redemptionFrames;
        this.minSpeechFrames = minSpeechFrames;
    }
    static async create(frameSamples = 1536, positiveSpeechThreshold = 0.5, negativeSpeechThreshold = 0.5 - 0.15, redemptionFrames = 15, minSpeechFrames = 1) {
        // Create an instance of the Silero VAD
        // model this only supports 16000hz PCM
        // audio at the moment.
        const silero = await Silero.create(16000);
        return new SpeechDetector(silero, frameSamples, positiveSpeechThreshold, negativeSpeechThreshold, redemptionFrames, minSpeechFrames);
    }
    resetSpeechDetection() {
        this.currentSpeechSegment = null;
        this.speaking = false;
        this.redemptionCounter = 0;
        this.speechFrameCount = 0;
        this.frameCount = 0;
    }
    emitSpeechSegment(segment) {
        this.speechSegmentsStreamController?.enqueue(segment.audioSegment);
    }
    startNewSpeechSegment(frame) {
        this.speaking = true;
        this.speechFrameCount = 1;
        this.currentSpeechSegment = {
            startSampleIndex: this.frameCount * this.frameSamples,
            endSampleIndex: 0,
            audioSegment: frame.slice(),
        };
    }
    appendToCurrentSpeechSegment(frame) {
        if (this.currentSpeechSegment) {
            this.speechFrameCount++;
            const newAudioSegment = new Float32Array(this.currentSpeechSegment.audioSegment.length + frame.length);
            newAudioSegment.set(this.currentSpeechSegment.audioSegment);
            newAudioSegment.set(frame, this.currentSpeechSegment.audioSegment.length);
            this.currentSpeechSegment.audioSegment = newAudioSegment;
        }
    }
    finalizeSpeechSegment() {
        if (this.currentSpeechSegment &&
            this.speechFrameCount >= this.minSpeechFrames) {
            this.currentSpeechSegment.endSampleIndex =
                this.frameCount * this.frameSamples;
            this.emitSpeechSegment(this.currentSpeechSegment);
            this.resetSpeechDetection();
        }
    }
    handleNonSpeechFrame(probability) {
        if (probability < this.negativeSpeechThreshold) {
            this.redemptionCounter++;
            if (this.redemptionCounter >= this.redemptionFrames) {
                this.finalizeSpeechSegment();
                this.speaking = false;
                this.speechFrameCount = 0;
                this.redemptionCounter = 0;
            }
        }
    }
    handleSpeechProbability(probability, frame) {
        if (probability > this.positiveSpeechThreshold) {
            if (!this.speaking) {
                this.startNewSpeechSegment(frame);
            }
            else {
                this.appendToCurrentSpeechSegment(frame);
            }
            this.redemptionCounter = 0;
        }
        else if (this.speaking) {
            this.handleNonSpeechFrame(probability);
        }
        this.frameCount++;
    }
    process(audio) {
        const speechSegmentsStream = new ReadableStream({
            start: (controller) => {
                this.speechSegmentsStreamController = controller;
            },
            cancel: () => {
                this.resetSpeechDetection();
            },
        });
        const reader = audio.getReader();
        const processFrame = async (frame) => {
            const probability = await this.silero.process(frame);
            this.handleSpeechProbability(probability, frame);
        };
        const readAndProcess = () => {
            reader
                .read()
                .then(({ done, value }) => {
                if (done) {
                    this.speechSegmentsStreamController?.close();
                    return;
                }
                if (value) {
                    this.processAudioChunk(value, processFrame, readAndProcess);
                }
            })
                .catch((error) => {
                this.speechSegmentsStreamController?.error(error);
            });
        };
        readAndProcess();
        return speechSegmentsStream;
    }
    async processAudioChunk(audioChunk, processFrame, readAndProcess) {
        for (let i = 0; i < audioChunk.length; i += this.frameSamples) {
            const frame = audioChunk.slice(i, i + this.frameSamples);
            await processFrame(frame);
        }
        readAndProcess();
    }
}
export { SpeechDetector };
