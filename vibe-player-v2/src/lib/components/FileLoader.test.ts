import { render, fireEvent, screen, act } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, type Mocked } from 'vitest';
import FileLoader from './FileLoader.svelte'; // Adjust path
import audioEngineService from '$lib/services/audioEngine.service';
import { playerStore } from '$lib/stores/player.store';
import { writable, type Writable } from 'svelte/store';

// Mock services
vi.mock('$lib/services/audioEngine.service', () => ({
    default: {
        unlockAudio: vi.fn(() => Promise.resolve()),
        loadFile: vi.fn(() => Promise.resolve()),
        // Add other methods if they are ever called directly or indirectly by FileLoader
        initialize: vi.fn(),
        dispose: vi.fn()
    }
}));

// Mock stores
let mockPlayerStoreValues: { fileName: string | null; error: string | null; status: string; isPlayable: boolean, isLoadingViaStore?: boolean }; // isLoadingViaStore is for testing component reaction
let mockPlayerStoreWritable: Writable<typeof mockPlayerStoreValues>;

vi.mock('$lib/stores/player.store', async () => {
    // Actual svelte/store is needed for the writable instance
    const { writable: actualWritable } = await import('svelte/store');
    mockPlayerStoreValues = { fileName: null, error: null, status: 'Ready', isPlayable: false, isLoadingViaStore: false };
    mockPlayerStoreWritable = actualWritable(mockPlayerStoreValues);
    return { playerStore: mockPlayerStoreWritable };
});


describe('FileLoader.svelte', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset store to default values before each test
        act(() => {
            mockPlayerStoreWritable.set({ fileName: null, error: null, status: 'Ready', isPlayable: false, isLoadingViaStore: false });
        });
    });

    it('renders the file input', () => {
        render(FileLoader);
        const fileInput = screen.getByLabelText(/Load Audio File/i); // Assuming h3 acts as a label for the section
        expect(fileInput.closest('div.card')?.querySelector('input[type="file"]')).toBeInTheDocument();
    });

    it('calls audioEngine.unlockAudio and loadFile on file selection', async () => {
        render(FileLoader);
        const fileInput = screen.getByLabelText<HTMLInputElement>(/Load Audio File/i).closest('div.card')?.querySelector('input[type="file"]');
        if (!fileInput) throw new Error('File input not found');

        const mockFile = new File(['dummy content'], 'test.mp3', { type: 'audio/mpeg' });
        const mockArrayBuffer = new ArrayBuffer(10);
        vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(mockArrayBuffer);

        await fireEvent.change(fileInput, { target: { files: [mockFile] } });

        expect(audioEngineService.unlockAudio).toHaveBeenCalledTimes(1);
        // Wait for promises in handleFileSelect to resolve
        await act(() => Promise.resolve());
        expect(audioEngineService.loadFile).toHaveBeenCalledWith(mockArrayBuffer, mockFile.name);
    });

    it('displays selected file name and size', async () => {
        render(FileLoader);
        const fileInput = screen.getByLabelText<HTMLInputElement>(/Load Audio File/i).closest('div.card')?.querySelector('input[type="file"]');
        if (!fileInput) throw new Error('File input not found');

        const mockFile = new File(['dummy content'], 'example.wav', { type: 'audio/wav', lastModified: Date.now() });
        Object.defineProperty(mockFile, 'size', { value: 1024 * 500 }); // 0.5 MB

        await fireEvent.change(fileInput, { target: { files: [mockFile] } });
        await act(() => Promise.resolve()); // allow store updates and component reactions

        expect(screen.getByText(`Selected: ${mockFile.name} (0.50 MB)`)).toBeInTheDocument();
    });

    it('shows loading indicator text while isLoading is true (component internal state)', async () => {
        (audioEngineService.loadFile as Mocked<any>).mockImplementationOnce(() =>
            new Promise(resolve => setTimeout(resolve, 100)) // Simulate delay
        );
        render(FileLoader);
        const fileInput = screen.getByLabelText<HTMLInputElement>(/Load Audio File/i).closest('div.card')?.querySelector('input[type="file"]');
        if (!fileInput) throw new Error('File input not found');

        const mockFile = new File(['dummy'], 'loading_test.mp3', { type: 'audio/mpeg' });
        vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(8));

        // Don't await this, to check intermediate loading state
        fireEvent.change(fileInput, { target: { files: [mockFile] } });

        await screen.findByText('Loading...'); // Component's internal isLoading state
        expect(screen.getByText('Loading...')).toBeInTheDocument();

        await act(() => vi.advanceTimersByTimeAsync(100)); // Resolve the loadFile promise
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    it('disables file input when isLoading (component internal state) is true', async () => {
        (audioEngineService.loadFile as Mocked<any>).mockImplementationOnce(() =>
            new Promise(resolve => setTimeout(resolve, 100))
        );
        render(FileLoader);
        const fileInput = screen.getByLabelText<HTMLInputElement>(/Load Audio File/i).closest('div.card')?.querySelector('input[type="file"]');
        if (!fileInput) throw new Error('File input not found');

        const mockFile = new File(['dummy'], 'test.mp3', { type: 'audio/mpeg' });
        vi.spyOn(mockFile, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(8));

        fireEvent.change(fileInput, { target: { files: [mockFile] } });
        await screen.findByText('Loading...'); // Wait for loading state to be true
        expect(fileInput).toBeDisabled();

        await act(() => vi.advanceTimersByTimeAsync(100)); // Resolve promise
        expect(fileInput).not.toBeDisabled();
    });

    it('displays status and error messages from playerStore', async () => {
        render(FileLoader);

        act(() => {
            mockPlayerStoreWritable.update(s => ({ ...s, status: 'Test Status Message' }));
        });
        expect(screen.getByText('Status: Test Status Message')).toBeInTheDocument();

        act(() => {
            mockPlayerStoreWritable.update(s => ({ ...s, error: 'Test Error Message' }));
        });
        expect(screen.getByText('Error: Test Error Message')).toBeInTheDocument();
    });
});
