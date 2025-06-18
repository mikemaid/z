// bin/pipeline.ts
#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();
new PipelineStack(app, 'S3ToGitHubPipelineStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region:  process.env.CDK_DEFAULT_REGION,
  },
});


// lib/pipeline-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as cpactions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ────────────────
    // 1) SOURCE BUCKET
    // ────────────────
    // Replace 'my-source-bucket' with your bucket name
    const sourceBucket = s3.Bucket.fromBucketName(
      this, 'SourceBucket', 'my-source-bucket'
    );

    // Artifact to hold the .xlsx from S3
    const sourceOutput = new codepipeline.Artifact('SourceOutput');

    // ────────────────
    // 2) PIPELINE
    // ────────────────
    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'S3ToGitHubPipeline',
      restartExecutionOnUpdate: true,
    });

    // ────────────────
    // 3) SOURCE STAGE
    // ────────────────
    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new cpactions.S3SourceAction({
          actionName: 'S3_Source',
          bucket: sourceBucket,
          // Key of your Excel file in S3.  
          // If it's at the root named "report.xlsx", use 'report.xlsx'.
          // If under a folder, e.g. 'incoming/data.xlsx', use that.
          bucketKey: 'report.xlsx',
          output: sourceOutput,
          trigger: cpactions.S3Trigger.EVENTS,
        }),
      ],
    });

    // ────────────────
    // 4) GITHUB TOKEN
    // ────────────────
    // Create a Secret in AWS Secrets Manager named "my-github-token"
    // whose value is your GitHub Personal Access Token (with repo:push).
    const githubSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'GitHubToken', 'my-github-token'
    );

    // ────────────────
    // 5) CODEBUILD PROJECT
    // ────────────────
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
      },
      environmentVariables: {
        // Inject the secret as the GITHUB_TOKEN env var
        GITHUB_TOKEN: {
          type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
          // we can reference the secret ARN
          value: githubSecret.secretArn,
        },
        // Your GitHub repo in "owner/name" form
        GITHUB_REPO: { value: 'my-org/my-repo' },
        // Branch you want to push into
        GITHUB_BRANCH: { value: 'main' },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              // install git
              'yum install -y git',
            ],
          },
          pre_build: {
            commands: [
              // configure git
              'git config --global user.name "AWS CodeBuild"',
              'git config --global user.email "codebuild@your-domain.com"',
              'echo Cloning GitHub repo...',
              'git clone https://$GITHUB_TOKEN@github.com/$GITHUB_REPO.git repo',
            ],
          },
          build: {
            commands: [
              'echo Copying .xlsx files into repo...',
              // copy *all* xlsx files from the S3 artifact
              'cp $CODEBUILD_SRC_DIR/*.xlsx repo/',
              'cd repo',
              'git add *.xlsx',
              'git commit -m "Add XLSX from S3 via CodePipeline"',
              'git push origin $GITHUB_BRANCH',
            ],
          },
        },
      }),
    });

    // Grant CodeBuild permissions
    githubSecret.grantRead(buildProject.role!);
    sourceBucket.grantRead(buildProject);

    // ────────────────
    // 6) BUILD STAGE
    // ────────────────
    pipeline.addStage({
      stageName: 'Build',
      actions: [
        new cpactions.CodeBuildAction({
          actionName: 'PushToGitHub',
          project: buildProject,
          input: sourceOutput,
        }),
      ],
    });
  }
}