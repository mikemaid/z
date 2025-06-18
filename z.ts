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

    const githubTokenParam = new cdk.CfnParameter(this, 'GitHubTokenParam', {
      type: 'String',
      noEcho: true,
      description: 'GitHub Token',
    });

    const githubSecret = new secretsmanager.Secret(this, 'GitHubTokenSecret', {
      secretName: 'github-token',
      secretObjectValue: {
        token: cdk.SecretValue.plainText(githubTokenParam.valueAsString),
      },
    });

    const sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new cdk.CfnOutput(this, 'SourceBucketName', {
        value: sourceBucket.bucketName,
    });

    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 's3-to-github',
      restartExecutionOnUpdate: false,
    });

    const sourceOutput = new codepipeline.Artifact('SourceOutput');

    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new cpactions.S3SourceAction({
          actionName: 'S3_Source',
          bucket: sourceBucket,
          bucketKey: 'IR Workbook.xlsx',
          output: sourceOutput,
          trigger: cpactions.S3Trigger.EVENTS,
        }),
      ],
    });

    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
      },
      environmentVariables: {
        GITHUB_REPO:  { value: 'f1zz42/IR-Workbooks' },
        GITHUB_BRANCH:{ value: 'main' },
        GITHUB_TOKEN: {
          type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
          value: githubSecret.secretArn,
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
            
        phases: {
          install: {
            commands: [
              //'yum install -y git',
              //'yum install -y zip',
            ],
          },
          pre_build: {
            commands: [
              'zip -r -X -0 "$CODEBUILD_SRC_DIR/IR Workbook.xlsx" *',
              'git config --global user.name "s3-to-github"',
              'git config --global user.email "launchpad.interns42@gmail.com"',
              'git clone https://f1zz42:$GITHUB_TOKEN@github.com/$GITHUB_REPO.git repo',
              'cd repo',
            ],
          },
          build: {
            commands: [
              'cp $CODEBUILD_SRC_DIR/IR Workbook.xlsx" "./IR Workbook.xlsx"',
              'git add "IR Workbook.xlsx"',
              'git commit -m "Add IR Workbook"',
              'git push origin $GITHUB_BRANCH',
            ],
          },
        },
        artifacts: {
          files: [ '**/*' ],
        },
      }),
    });

    githubSecret.grantRead(buildProject.role!);
    sourceBucket.grantRead(buildProject);

    pipeline.addStage({
      stageName: 'Build',
      actions: [
        new cpactions.CodeBuildAction({
          actionName: 's3-to-github',
          project: buildProject,
          input: sourceOutput,
        }),
      ],
    });
  }
}
