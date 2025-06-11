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

/** Research agent state interface - tracks connection activity and workflow state */
interface ResearchState {
    lastActivity: number;
    currentWorkflowId: string | null;
    workflowStartTime: number | null;
    workflowStatus: "running" | "completed" | "failed" | null;
    researchTopic: string | null;
    researchDepth: number | null;
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
    startTime: z.number().optional().describe("Unix timestamp when the workflow started"),
    researchDepth: z.number().optional().describe("Research depth level (1-5)"),
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

/** Schema for connection confirmation messages - sent when client connects */
const ConnectedSchema = z.object({
    type: z.literal("connected").describe("Message type identifier for connection confirmations"),
    status: z.string().describe("Current agent status (ready, processing, etc.)"),
    message: z.string().describe("Human-readable status message"),
    researchTopic: z.string().optional().describe("Current/completed research topic"),
    researchDepth: z.number().optional().describe("Current/completed research depth"),
});

/** Union schema for all outgoing message types */
const OutgoingMessageSchema = z.discriminatedUnion("type", [
    ResearchStartedSchema,
    ResearchCompletedSchema,
    PongSchema,
    ErrorSchema,
    ConnectedSchema,
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
     * Called when a new WebSocket connection is established
     * Reports current workflow status and sends initial connection confirmation
     */
    async onConnect(connection: Connection) {
        console.log("=== Research Agent onConnect ===");
        console.log("Connection ID:", connection.id);

        // Update connection state
        connection.setState({
            lastActivity: Date.now(),
            connectedAt: Date.now(),
        });

        // Check and report current workflow status
        await this.reportCurrentWorkflowStatus(connection);
    }

    /**
     * Checks current workflow status and reports appropriate state to the connection
     * Reusable method for both onConnect and status checking scenarios
     */
    private async reportCurrentWorkflowStatus(connection: Connection) {
        const currentState = this.state || {
            lastActivity: 0,
            currentWorkflowId: null,
            workflowStartTime: null,
            workflowStatus: null,
            researchTopic: null,
            researchDepth: null,
        };

        if (!currentState.currentWorkflowId) {
            // No active workflow
            this.sendMessage(connection, {
                type: "connected",
                status: "ready",
                message: "Ready for research requests",
            });
            return;
        }

        console.log(
            "Workflow found:",
            currentState.currentWorkflowId,
            "status:",
            currentState.workflowStatus,
        );

        try {
            const workflowInstance = await this.env.DEEP_RESEARCH_WORKFLOW.get(
                currentState.currentWorkflowId,
            );
            const status = await workflowInstance.status();

            console.log(
                "Current workflow status:",
                status.status,
                "Output available:",
                !!status.output,
            );

            if (status.status === "running") {
                // Update state to running and continue monitoring
                this.setState({
                    ...currentState,
                    lastActivity: Date.now(),
                    workflowStatus: "running",
                });

                this.sendMessage(connection, {
                    type: "research_started",
                    topic: currentState.researchTopic || "Resuming active research...",
                    status: "processing",
                    workflowId: currentState.currentWorkflowId,
                    startTime: currentState.workflowStartTime || undefined,
                    researchDepth: currentState.researchDepth || undefined,
                });

                // Continue monitoring for the new connection
                await this.scheduleWorkflowMonitoring(
                    connection,
                    currentState.currentWorkflowId,
                    currentState.researchTopic || "Active research",
                );
            } else if (status.status === "complete" && status.output) {
                // Workflow completed successfully - send connected message with topic/depth, then send results
                console.log("Workflow completed, sending results to frontend");

                this.setState({
                    ...currentState,
                    lastActivity: Date.now(),
                    workflowStatus: "completed",
                });

                this.sendMessage(connection, {
                    type: "connected",
                    status: "completed",
                    message: "Research completed - displaying results",
                    researchTopic: currentState.researchTopic || undefined,
                    researchDepth: currentState.researchDepth || undefined,
                });

                // Query workflow for results and send them immediately
                const output = status.output as WorkflowOutput;
                console.log("Sending completed research results:", {
                    topic: output.originalTopic,
                    wordCount: output.reportMetadata?.wordCount,
                    insights: output.uniqueInsights,
                    sources: output.uniqueSources,
                });

                this.sendMessage(connection, {
                    type: "research_completed",
                    topic: output.originalTopic,
                    report: output.report,
                    status: "completed",
                    metadata: {
                        workflowId: currentState.currentWorkflowId,
                        insights: output.uniqueInsights,
                        sources: output.uniqueSources,
                        wordCount: output.reportMetadata.wordCount,
                        generatedAt: output.reportMetadata.generatedAt,
                    },
                });
            } else {
                // Workflow failed, errored, terminated, or completed without output
                console.log("Workflow in failed/error state:", status.status);

                this.setState({
                    ...currentState,
                    lastActivity: Date.now(),
                    workflowStatus: "failed",
                });

                this.sendMessage(connection, {
                    type: "connected",
                    status: "failed",
                    message: "Previous research failed",
                    researchTopic: currentState.researchTopic || undefined,
                    researchDepth: currentState.researchDepth || undefined,
                });

                this.sendMessage(connection, {
                    type: "research_completed",
                    topic: currentState.researchTopic || "Failed research",
                    status: "error",
                    error: (status as any).error || `Workflow ${status.status}`,
                });
            }
        } catch (error) {
            console.error("Failed to check active workflow status:", error);
            this.clearWorkflowState();
            this.sendMessage(connection, {
                type: "connected",
                status: "ready",
                message: "Ready for research requests",
            });
        }
    }

    /**
     * Handles workflow completion/failure and updates agent state
     * Reusable method for both monitoring and connection scenarios
     * Note: Does not clear workflow state - state is only cleared when user starts new research
     */
    private async handleWorkflowCompletion(connection: Connection, status: any, topic: string) {
        const currentState = this.state || {
            lastActivity: 0,
            currentWorkflowId: null,
            workflowStartTime: null,
            workflowStatus: null,
        };

        if (status.status === "complete") {
            const output = status.output as WorkflowOutput;

            // Update state to completed (but don't clear workflow info)
            this.setState({
                ...currentState,
                lastActivity: Date.now(),
                workflowStatus: "completed",
            });

            this.sendMessage(connection, {
                type: "research_completed",
                topic: output.originalTopic,
                report: output.report,
                status: "completed",
                metadata: {
                    workflowId: currentState.currentWorkflowId || "",
                    insights: output.uniqueInsights,
                    sources: output.uniqueSources,
                    wordCount: output.reportMetadata.wordCount,
                    generatedAt: output.reportMetadata.generatedAt,
                },
            });
        } else {
            // Workflow failed or terminated
            this.setState({
                ...currentState,
                lastActivity: Date.now(),
                workflowStatus: "failed",
            });

            this.sendMessage(connection, {
                type: "research_completed",
                topic: topic,
                status: "error",
                error: (status as any).error || "Workflow failed",
            });
        }

        // Note: Workflow state is not cleared here - it will be cleared when user starts new research
    }

    /**
     * Clears the current workflow ID, start time, status, topic, and depth from agent state
     * Called when starting new research or on errors
     */
    private clearWorkflowState() {
        const currentState = this.state || {
            lastActivity: 0,
            currentWorkflowId: null,
            workflowStartTime: null,
            workflowStatus: null,
            researchTopic: null,
            researchDepth: null,
        };
        this.setState({
            ...currentState,
            lastActivity: Date.now(),
            currentWorkflowId: null,
            workflowStartTime: null,
            workflowStatus: null,
            researchTopic: null,
            researchDepth: null,
        });
    }

    /**
     * Helper method to send type-safe messages to connected clients
     * Ensures all outgoing messages conform to the defined schemas
     */
    private sendMessage(connection: Connection, message: OutgoingMessage) {
        connection.send(JSON.stringify(message));
    }

    /**
     * Helper method to broadcast type-safe messages to all connected clients
     * Sends the same message to all connections for this agent instance (same chatId)
     */
    private broadcastMessage(message: OutgoingMessage) {
        // Use the Agent's built-in broadcast functionality if available
        // If not available, we would need to iterate through connections manually
        try {
            // Try to use broadcast method (may be available in Agents framework)
            if (typeof (this as any).broadcast === 'function') {
                (this as any).broadcast(JSON.stringify(message));
            } else {
                // Fallback: iterate through connections if broadcast is not available
                console.log("Broadcast method not available, message will be sent on next connection");
                // Note: The message will be sent when users reconnect via reportCurrentWorkflowStatus
            }
        } catch (error) {
            console.error("Failed to broadcast message:", error);
            // Fallback: message will be delivered on reconnection
        }
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

        // Check if there's already a workflow for this agent
        const currentState = this.state || {
            lastActivity: 0,
            currentWorkflowId: null,
            workflowStartTime: null,
            workflowStatus: null,
            researchTopic: null,
            researchDepth: null,
        };
        if (currentState.currentWorkflowId) {
            if (currentState.workflowStatus === "running") {
                console.log(
                    "Research already in progress with workflow ID:",
                    currentState.currentWorkflowId,
                );
                this.sendError(
                    connection,
                    "Research already in progress. Please wait for current research to complete or cancel it first.",
                );
                return;
            } else {
                // Clear completed/failed workflow to start new one
                console.log(
                    "Clearing previous workflow:",
                    currentState.currentWorkflowId,
                    "status:",
                    currentState.workflowStatus,
                );
                this.clearWorkflowState();
            }
        }

        // Update connection state with current research details
        const currentConnectionState = connection.state || {};
        connection.setState({
            ...currentConnectionState,
            lastActivity: Date.now(),
            currentTopic: data.topic,
        });

        try {
            // Start the DeepResearchWorkflow
            const workflowInstance = await this.env.DEEP_RESEARCH_WORKFLOW.create({
                params: {
                    searchTopic: data.topic,
                    researchDepth: data.depth || 2, // Default depth of 2
                },
            });

            console.log("Workflow started with ID:", workflowInstance.id);

            const workflowStartTime = Date.now();

            // Update agent state with the current workflow ID, start time, topic, depth, and running status
            this.setState({
                lastActivity: Date.now(),
                currentWorkflowId: workflowInstance.id,
                workflowStartTime: workflowStartTime,
                workflowStatus: "running",
                researchTopic: data.topic,
                researchDepth: data.depth || 2,
            });

            // Send acknowledgment with workflow ID and start time
            this.sendMessage(connection, {
                type: "research_started",
                topic: data.topic,
                status: "processing",
                workflowId: workflowInstance.id,
                startTime: workflowStartTime,
                researchDepth: data.depth || 2,
            });

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

            // Clear the current workflow ID from agent state on error
            this.clearWorkflowState();

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
     * Uses Agents scheduling system for reliable monitoring
     */
    private async scheduleWorkflowMonitoring(
        connection: Connection,
        workflowId: string,
        topic: string,
    ) {
        console.log(`Scheduling workflow monitoring for ${workflowId}`);

        // Schedule initial check after 5 seconds
        await this.schedule(5, "checkWorkflowStatus", {
            workflowId,
            topic,
            connectionId: connection.id,
        });
    }

    /**
     * Scheduled task handler for checking workflow status
     * Called by the Agents framework at scheduled intervals
     * Checks if the workflow is still relevant (matches current agent state) before proceeding
     */
    async checkWorkflowStatus(data: { workflowId: string; topic: string; connectionId: string }) {
        const { workflowId, topic } = data;

        console.log(`Checking workflow ${workflowId} status via scheduled task`);

        const currentState = this.state || {
            lastActivity: 0,
            currentWorkflowId: null,
            workflowStartTime: null,
            workflowStatus: null,
            researchTopic: null,
            researchDepth: null,
        };

        // Only proceed if this workflow is still the current one for this agent
        if (currentState.currentWorkflowId !== workflowId) {
            console.log(
                `Workflow ${workflowId} is no longer current (current: ${currentState.currentWorkflowId}), stopping monitoring`,
            );
            return;
        }

        try {
            const instance = await this.env.DEEP_RESEARCH_WORKFLOW.get(workflowId);
            const status = await instance.status();

            console.log(`Workflow ${workflowId} status:`, status.status);

            if (
                status.status === "complete" ||
                status.status === "errored" ||
                status.status === "terminated"
            ) {
                // Workflow completed or failed - update state and broadcast to all connected clients
                if (status.status === "complete") {
                    const output = status.output as WorkflowOutput;
                    
                    this.setState({
                        ...currentState,
                        lastActivity: Date.now(),
                        workflowStatus: "completed",
                    });

                    // Broadcast completion message to all connected clients for this chatId
                    this.broadcastMessage({
                        type: "research_completed",
                        topic: output.originalTopic,
                        report: output.report,
                        status: "completed",
                        metadata: {
                            workflowId: currentState.currentWorkflowId || "",
                            insights: output.uniqueInsights,
                            sources: output.uniqueSources,
                            wordCount: output.reportMetadata.wordCount,
                            generatedAt: output.reportMetadata.generatedAt,
                        },
                    });
                } else {
                    this.setState({
                        ...currentState,
                        lastActivity: Date.now(),
                        workflowStatus: "failed",
                    });

                    // Broadcast error message to all connected clients for this chatId
                    this.broadcastMessage({
                        type: "research_completed",
                        topic: topic,
                        status: "error",
                        error: (status as any).error || "Workflow failed",
                    });
                }

                console.log("Research completed/failed for topic:", topic);
                console.log("Completion message broadcast to all connected clients in this session");
                return; // Stop checking
            }

            // Workflow still running, schedule next check in 10 seconds
            await this.schedule(10, "checkWorkflowStatus", {
                workflowId,
                topic,
                connectionId: data.connectionId,
            });
        } catch (error) {
            console.error("Failed to check workflow status:", error);

            // Clear the current workflow ID from agent state on error
            this.clearWorkflowState();
        }
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

        // Check if this is the current workflow for this agent
        const currentState = this.state || {
            lastActivity: 0,
            currentWorkflowId: null,
            workflowStartTime: null,
            workflowStatus: null,
            researchTopic: null,
            researchDepth: null,
        };
        if (currentState.currentWorkflowId !== data.workflowId) {
            console.log(
                "Cancel request for non-current workflow:",
                data.workflowId,
                "current:",
                currentState.currentWorkflowId,
            );
            this.sendError(connection, "Cannot cancel workflow: not the current active workflow");
            return;
        }

        if (currentState.workflowStatus !== "running") {
            console.log(
                "Cannot cancel non-running workflow:",
                data.workflowId,
                "status:",
                currentState.workflowStatus,
            );
            this.sendError(connection, "Cannot cancel workflow: workflow is not currently running");
            return;
        }

        try {
            // Get the workflow instance and terminate it immediately
            const workflowInstance = await this.env.DEEP_RESEARCH_WORKFLOW.get(data.workflowId);
            await workflowInstance.terminate();

            console.log("Workflow terminated:", data.workflowId);

            // Clear the current workflow ID from agent state
            this.clearWorkflowState();

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
