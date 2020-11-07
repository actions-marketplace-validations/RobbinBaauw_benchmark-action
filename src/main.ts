import { getInput, setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import table from "markdown-table";
import { WebhookPayload } from "@actions/github/lib/interfaces";
import { Context } from "@actions/github/lib/context";
import { executeBenchmarkScript } from "./benchmark";
import { BENCHMARK_HEADING, formatResults } from "./format";

async function fetchPreviousComment(
    octokit: ReturnType<typeof getOctokit>,
    repo: { owner: string; repo: string },
    pr: { number: number },
) {
    const commentList = await octokit.issues.listComments({
        ...repo,
        issue_number: pr.number,
    });

    return commentList.data.find((comment) => comment.body.startsWith(BENCHMARK_HEADING));
}

type GHRepo = Context["repo"];
type GHPullRequest = WebhookPayload["pull_request"];

function getOptions() {
    return {
        token: getInput("github_token"),
        buildScript: getInput("build_script") || "build",
        benchmarkScript: getInput("benchmark_script"),
        workingDirectory: getInput("working_directory") || process.cwd(),
    };
}

async function compareToRef(ref: string, pr?: GHPullRequest, repo?: GHRepo) {
    const { token, buildScript, benchmarkScript, workingDirectory } = getOptions();

    const octokit = getOctokit(token);

    const base = await executeBenchmarkScript(buildScript, benchmarkScript, undefined, workingDirectory);
    const current = await executeBenchmarkScript(buildScript, benchmarkScript, ref, workingDirectory);

    if (pr && repo) {
        const body = formatResults(base, current);
        const previousComment = await fetchPreviousComment(octokit, repo, pr);

        try {
            if (!previousComment) {
                await octokit.issues.createComment({
                    ...repo,
                    issue_number: pr.number,
                    body,
                });
            } else {
                await octokit.issues.updateComment({
                    ...repo,
                    comment_id: previousComment.id,
                    body,
                });
            }
        } catch (error) {
            console.log(
                "Error creating/updating comment. This can happen for PR's originating from a fork without write permissions.",
            );
        }
    }
}

async function run() {
    const pr = context.payload.pull_request;

    try {
        if (pr) {
            await compareToRef(pr.base.ref as string, pr, context.repo);
        } else {
            await compareToRef("HEAD^");
        }
    } catch (error) {
        setFailed(error.message);
    }
}

run();
