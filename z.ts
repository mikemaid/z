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

    //
    // 1) GitHub token parameter & secret
    //
    const githubTokenParam = new cdk.CfnParameter(this, 'GitHubTokenParam', {
      type: 'String',
      noEcho: true,
      description: 'GitHub Personal Access Token (with repo:push scope)',
    });

    const githubSecret = new secretsmanager.Secret(this, 'GitHubTokenSecret', {
      secretName: 'my-github-token',
      secretObjectValue: {
        // store the raw token under JSON key "token"
        token: cdk.SecretValue.plainText(githubTokenParam.valueAsString),
      },
    });

    //
    // 2) Create the S3 bucket (source)
    //
    const sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,    // for dev; remove in prod!
      autoDeleteObjects: true,                     // for dev convenience
    });

    //
    // 3) CodePipeline + artifact
    //
    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'S3ToGitHubPipeline',
      restartExecutionOnUpdate: true,
    });
    const sourceOutput = new codepipeline.Artifact('SourceOutput');

    //
    // 4) Source Stage: watch for new/updated .xlsx in the bucket
    //
    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new cpactions.S3SourceAction({
          actionName: 'S3_Source',
          bucket: sourceBucket,
          bucketKey: 'report.xlsx',           // change if your key differs
          output: sourceOutput,
          trigger: cpactions.S3Trigger.EVENTS,
        }),
      ],
    });

    //
    // 5) CodeBuild project: clone, copy .xlsx, commit & push
    //
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
      },
      environmentVariables: {
        GITHUB_REPO:  { value: 'my-org/my-repo' },  // your repo “owner/name”
        GITHUB_BRANCH:{ value: 'main' },            // your target branch
        // pull the token JSON key “token” from Secrets Manager
        GITHUB_TOKEN: {
          type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
          value: `${githubSecret.secretArn}:SecretString:token:AWSCURRENT`,
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'yum install -y git',
            ],
          },
          pre_build: {
            commands: [
              'echo Configuring Git...',
              'git config --global user.name "AWS CodeBuild"',
              'git config --global user.email "codebuild@your-domain.com"',
              'echo Cloning GitHub repo...',
              'git clone https://$GITHUB_TOKEN@github.com/$GITHUB_REPO.git repo',
            ],
          },
          build: {
            commands: [
              'echo Copying .xlsx files into repo...',
              'cp $CODEBUILD_SRC_DIR/*.xlsx repo/',
              'cd repo',
              'git add *.xlsx',
              'git commit -m "Add XLSX from S3 via CodePipeline" || echo "no changes"',
              'git push origin $GITHUB_BRANCH',
            ],
          },
        },
        artifacts: {
          files: [ '**/*' ],  // not strictly needed here
        },
      }),
    });

    // grant permissions
    githubSecret.grantRead(buildProject.role!);
    sourceBucket.grantRead(buildProject);

    //
    // 6) Build Stage: run CodeBuild
    //
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