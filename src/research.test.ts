import { describe, it, expect } from "vitest";
import type { SearchResult } from "exa-js";
import { toLightweightResult } from "./research";

describe("toLightweightResult", () => {
    it("should convert SearchResult to lightweight format with all fields", () => {
        const mockResult: SearchResult<any> = {
            title: "AI Testing Best Practices",
            url: "https://example.com/ai-testing",
            text: "This is a comprehensive guide to testing AI applications. It covers mocking strategies, handling non-deterministic responses, and ensuring reliable test suites.",
            score: 0.95,
            id: "test-id",
            publishedDate: "2024-01-01",
            author: "Test Author",
        };

        const result = toLightweightResult(mockResult);

        expect(result).toEqual({
            title: "AI Testing Best Practices",
            url: "https://example.com/ai-testing",
            snippet:
                "This is a comprehensive guide to testing AI applications. It covers mocking strategies, handling non-deterministic responses, and ensuring reliable test suites.",
            score: 0.95,
        });
    });

    it("should truncate text to 300 characters", () => {
        const longText = "A".repeat(500); // 500 characters
        const mockResult: SearchResult<any> = {
            title: "Long Article",
            url: "https://example.com/long",
            text: longText,
            score: 0.8,
            id: "test-id",
        };

        const result = toLightweightResult(mockResult);

        expect(result.snippet).toHaveLength(300);
        expect(result.snippet).toBe("A".repeat(300));
    });

    it('should handle missing title with default "Untitled"', () => {
        const mockResult: SearchResult<any> = {
            title: null,
            url: "https://example.com/no-title",
            text: "Content without title",
            score: 0.6,
            id: "test-id",
        };

        const result = toLightweightResult(mockResult);

        expect(result.title).toBe("Untitled");
        expect(result.url).toBe("https://example.com/no-title");
        expect(result.snippet).toBe("Content without title");
        expect(result.score).toBe(0.6);
    });

    it('should handle empty title with default "Untitled"', () => {
        const mockResult: SearchResult<any> = {
            title: "",
            url: "https://example.com/empty-title",
            text: "Content with empty title",
            score: 0.7,
            id: "test-id",
        };

        const result = toLightweightResult(mockResult);

        expect(result.title).toBe("Untitled");
    });

    it("should handle missing text with empty string", () => {
        const mockResult: SearchResult<any> = {
            title: "Article Without Content",
            url: "https://example.com/no-content",
            text: "",
            score: 0.5,
            id: "test-id",
        };

        const result = toLightweightResult(mockResult);

        expect(result.snippet).toBe("");
        expect(result.title).toBe("Article Without Content");
    });

    it("should handle empty text with empty string", () => {
        const mockResult: SearchResult<any> = {
            title: "Article With Empty Content",
            url: "https://example.com/empty-content",
            text: "",
            score: 0.4,
            id: "test-id",
        };

        const result = toLightweightResult(mockResult);

        expect(result.snippet).toBe("");
    });

    it("should preserve exact score value", () => {
        const mockResult: SearchResult<any> = {
            title: "Precision Test",
            url: "https://example.com/precision",
            text: "Testing score precision",
            score: 0.123456789,
            id: "test-id",
        };

        const result = toLightweightResult(mockResult);

        expect(result.score).toBe(0.123456789);
    });

    it("should handle text exactly at 300 characters", () => {
        const exactText = "X".repeat(300);
        const mockResult: SearchResult<any> = {
            title: "Exact Length Test",
            url: "https://example.com/exact",
            text: exactText,
            score: 0.9,
            id: "test-id",
        };

        const result = toLightweightResult(mockResult);

        expect(result.snippet).toHaveLength(300);
        expect(result.snippet).toBe(exactText);
    });

    it("should handle text shorter than 300 characters", () => {
        const shortText = "Short content";
        const mockResult: SearchResult<any> = {
            title: "Short Article",
            url: "https://example.com/short",
            text: shortText,
            score: 0.85,
            id: "test-id",
        };

        const result = toLightweightResult(mockResult);

        expect(result.snippet).toBe(shortText);
        expect(result.snippet.length).toBeLessThan(300);
    });

    it("should handle special characters in text and title", () => {
        const mockResult: SearchResult<any> = {
            title: 'Special Characters: "Quotes", & Symbols!',
            url: "https://example.com/special-chars",
            text: "Content with special chars: <html lang='en'>, {json}, [arrays], and unicode: 🚀💻",
            score: 0.75,
            id: "test-id",
        };

        const result = toLightweightResult(mockResult);

        expect(result.title).toBe('Special Characters: "Quotes", & Symbols!');
        expect(result.snippet).toBe(
            "Content with special chars: <html lang='en'>, {json}, [arrays], and unicode: 🚀💻",
        );
    });
});
