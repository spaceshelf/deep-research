/**
 * ResearcherAgent - WebSocket-based research agent for deep research workflows
 *
 * This agent handles real-time communication between the frontend and the DeepResearchWorkflow,
 * providing progress updates, cancellation capabilities, and result delivery via WebSocket.
 *
 * Features:
 * - Type-safe message validation using Zod schemas
 * - Real-time workflow progress monitoring
 * - Workflow cancellation support
 * - Error handling and user feedback
 * - Connection state management
 */

import { Agent, Connection } from "agents";
import { z } from "zod";
import type { WorkflowOutput } from "./workflow";

/** Research agent state interface - tracks connection activity for cleanup and monitoring */
interface ResearchState {
    lastActivity: number;
}

/** Environment interface for Cloudflare Workers bindings */
interface Env {
    DEEP_RESEARCH_WORKFLOW: Workflow;
}

/** Schema for research request messages - initiates a new research workflow */
const ResearchRequestSchema = z.object({
    type: z.literal("research_request").describe("Message type identifier for research requests"),
    topic: z.string().min(1).describe("Research topic or query to investigate"),
    depth: z.number().min(1).max(5).optional().describe("Research depth level (1-5, default: 2)"),
    timestamp: z.number().optional().describe("Client timestamp when message was sent"),
});

/** Schema for ping messages - used for connection health checks */
const PingSchema = z.object({
    type: z.literal("ping").describe("Message type identifier for connection health checks"),
    timestamp: z.number().optional().describe("Client timestamp when ping was sent"),
});

/** Schema for cancel request messages - terminates running workflows */
const CancelRequestSchema = z.object({
    type: z.literal("cancel_request").describe("Message type identifier for workflow cancellation"),
    workflowId: z.string().describe("Unique identifier of the workflow to terminate"),
    timestamp: z.number().optional().describe("Client timestamp when cancellation was requested"),
});

/** Union schema for all incoming message types */
const IncomingMessageSchema = z.discriminatedUnion("type", [
    ResearchRequestSchema,
    PingSchema,
    CancelRequestSchema,
]);

/** Schema for research started notification - sent when workflow begins */
const ResearchStartedSchema = z.object({
    type: z.literal("research_started").describe("Message type identifier for research initiation"),
    topic: z.string().describe("The research topic that was started"),
    status: z
        .literal("processing")
        .describe("Current workflow status (always 'processing' for started)"),
    workflowId: z.string().describe("Unique identifier of the started workflow"),
});

/** Schema for research completion notification - sent when workflow finishes or fails */
const ResearchCompletedSchema = z.object({
    type: z
        .literal("research_completed")
        .describe("Message type identifier for research completion"),
    topic: z.string().describe("The research topic that was completed or failed"),
    status: z.enum(["completed", "error"]).describe("Final status of the research workflow"),
    report: z
        .string()
        .optional()
        .describe("Generated markdown research report (present on success)"),
    error: z
        .string()
        .optional()
        .describe("Error message describing failure reason (present on error)"),
    metadata: z
        .object({
            workflowId: z.string().describe("Unique identifier of the completed workflow"),
            insights: z.number().describe("Number of unique insights discovered"),
            sources: z.number().describe("Number of unique sources analyzed"),
            wordCount: z.number().optional().describe("Total word count of the generated report"),
            generatedAt: z.string().optional().describe("ISO timestamp when report was generated"),
        })
        .optional()
        .describe("Additional metadata about the research results"),
});

/** Schema for pong response messages - responds to ping health checks */
const PongSchema = z.object({
    type: z.literal("pong").describe("Message type identifier for ping responses"),
    timestamp: z.number().describe("Server timestamp when pong was sent"),
});

/** Schema for error messages - sent when operations fail */
const ErrorSchema = z.object({
    type: z.literal("error").describe("Message type identifier for error notifications"),
    message: z.string().describe("Human-readable error message describing what went wrong"),
});

/** Union schema for all outgoing message types */
const OutgoingMessageSchema = z.discriminatedUnion("type", [
    ResearchStartedSchema,
    ResearchCompletedSchema,
    PongSchema,
    ErrorSchema,
]);
type OutgoingMessage = z.infer<typeof OutgoingMessageSchema>;
type ResearchRequest = z.infer<typeof ResearchRequestSchema>;

/**
 * ResearcherAgent class - handles WebSocket connections for research workflows
 *
 * This agent manages the lifecycle of research requests, from initial validation
 * through workflow execution to result delivery and cancellation handling.
 */
export class ResearcherAgent extends Agent<Env, ResearchState> {
    /**
     * Helper method to send type-safe messages to connected clients
     * Ensures all outgoing messages conform to the defined schemas
     */
    private sendMessage(connection: Connection, message: OutgoingMessage) {
        connection.send(JSON.stringify(message));
    }

    /**
     * Helper method to send standardized error messages
     * Provides consistent error format across all error scenarios
     */
    private sendError(connection: Connection, message: string) {
        this.sendMessage(connection, {
            type: "error",
            message,
        });
    }

    /**
     * Main message handler for incoming WebSocket messages
     * Validates message format and routes to appropriate handlers
     */
    async onMessage(connection: Connection, message: any) {
        console.log("=== Research Agent onMessage ===");
        console.log("Connection ID:", connection.id);
        console.log("Raw message:", message);

        if (typeof message !== "string") {
            console.log("Non-string message received:", typeof message);
            return;
        }

        let rawData;
        try {
            rawData = JSON.parse(message);
        } catch (e) {
            console.error("Failed to parse message:", e);
            this.sendError(connection, "Invalid JSON format");
            return;
        }

        console.log("Parsed message:", rawData);

        // Validate message with Zod
        const parseResult = IncomingMessageSchema.safeParse(rawData);
        if (!parseResult.success) {
            console.error("Message validation failed:", parseResult.error.format());
            this.sendError(connection, "Invalid message format");
            return;
        }

        const data = parseResult.data;
        console.log("Validated message:", data);

        if (data.type === "research_request") {
            await this.handleResearchRequest(connection, data);
            return;
        }

        if (data.type === "ping") {
            this.sendMessage(connection, {
                type: "pong",
                timestamp: Date.now(),
            });
            return;
        }

        if (data.type === "cancel_request") {
            await this.handleCancelRequest(connection, data);
            return;
        }
    }

    /**
     * Handles new research requests by starting a DeepResearchWorkflow
     * Updates connection and agent state, then monitors workflow progress
     */
    private async handleResearchRequest(connection: Connection, data: ResearchRequest) {
        console.log("Processing research request for topic:", data.topic);

        // Update connection state with current research details
        const currentConnectionState = connection.state || {};
        connection.setState({
            ...currentConnectionState,
            lastActivity: Date.now(),
            currentTopic: data.topic,
        });

        // Update agent state
        const currentState = this.state || { activeResearches: 0, lastActivity: 0 };
        this.setState({
            ...currentState,
            lastActivity: Date.now(),
        });

        try {
            // Start the DeepResearchWorkflow
            const workflowInstance = await this.env.DEEP_RESEARCH_WORKFLOW.create({
                params: {
                    searchTopic: data.topic,
                    researchDepth: data.depth || 2, // Default depth of 2
                },
            });

            // Send acknowledgment with workflow ID
            this.sendMessage(connection, {
                type: "research_started",
                topic: data.topic,
                status: "processing",
                workflowId: workflowInstance.id,
            });

            console.log("Workflow started with ID:", workflowInstance.id);

            // Store workflow ID in connection state for tracking
            connection.setState({
                ...connection.state,
                workflowId: workflowInstance.id,
                workflowStartTime: Date.now(),
            });

            // Schedule periodic status checks
            await this.scheduleWorkflowMonitoring(connection, workflowInstance.id, data.topic);
        } catch (error) {
            console.error("Failed to start workflow:", error);
            this.sendMessage(connection, {
                type: "research_completed",
                topic: data.topic,
                status: "error",
                error: "Failed to start research workflow",
            });
        }
    }

    /**
     * Monitors workflow progress and sends status updates to the client
     * Polls workflow status every 10 seconds until completion or failure
     */
    private async scheduleWorkflowMonitoring(
        connection: Connection,
        workflowId: string,
        topic: string,
    ) {
        // Recursive function to check workflow status every 10 seconds
        const checkStatus = async () => {
            try {
                const instance = await this.env.DEEP_RESEARCH_WORKFLOW.get(workflowId);
                const status = await instance.status();

                console.log(`Workflow ${workflowId} status:`, status.status);

                if (status.status === "complete") {
                    // Workflow completed successfully
                    const output = status.output as WorkflowOutput;

                    this.sendMessage(connection, {
                        type: "research_completed",
                        topic: topic,
                        report: output.report,
                        status: "completed",
                        metadata: {
                            workflowId: workflowId,
                            insights: output.uniqueInsights,
                            sources: output.uniqueSources,
                            wordCount: output.reportMetadata.wordCount,
                            generatedAt: output.reportMetadata.generatedAt,
                        },
                    });

                    console.log("Research completed for topic:", topic);
                    return; // Stop checking
                }

                if (status.status === "errored" || status.status === "terminated") {
                    // Workflow failed
                    this.sendMessage(connection, {
                        type: "research_completed",
                        topic: topic,
                        status: "error",
                        error: (status as any).error || "Workflow failed",
                    });

                    console.error("Workflow failed for topic:", topic);
                    return; // Stop checking
                }

                // Workflow still running, check again in 10 seconds
                setTimeout(checkStatus, 10000);
            } catch (error) {
                console.error("Failed to check workflow status:", error);
                this.sendMessage(connection, {
                    type: "research_completed",
                    topic: topic,
                    status: "error",
                    error: "Failed to monitor research progress",
                });
            }
        };

        // Start monitoring after a short delay
        setTimeout(checkStatus, 5000);
    }

    /**
     * Handles workflow cancellation requests by terminating the specified workflow
     * Sends confirmation message back to the client upon successful termination
     */
    private async handleCancelRequest(
        connection: Connection,
        data: z.infer<typeof CancelRequestSchema>,
    ) {
        console.log("Processing cancel request for workflow:", data.workflowId);

        try {
            // Get the workflow instance and terminate it immediately
            const workflowInstance = await this.env.DEEP_RESEARCH_WORKFLOW.get(data.workflowId);
            await workflowInstance.terminate();

            console.log("Workflow terminated:", data.workflowId);

            // Send confirmation
            this.sendMessage(connection, {
                type: "research_completed",
                topic: "cancelled",
                status: "error",
                error: "Research cancelled by user",
            });
        } catch (error) {
            console.error("Failed to cancel workflow:", error);
            this.sendError(connection, "Failed to cancel research");
        }
    }
}
