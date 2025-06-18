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

    // … (GitHub token param/secret, bucket creation, pipeline & source stage all as before)

    const sourceBucket = new s3.Bucket(this, 'SourceBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // grant CodeBuild read access
    // (we’ll also refer to bucket name in the build environment)
    sourceBucket.grantRead(buildProject?.role!);

    // … pipeline + S3SourceAction to trigger on uploads of 'report.xlsx' …

    // 5) CodeBuild project: clone, download XLSX directly from S3, commit & push
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
      },
      environmentVariables: {
        // so buildspec can do: aws s3 cp s3://$SOURCE_BUCKET/report.xlsx
        SOURCE_BUCKET: { value: sourceBucket.bucketName },
        GITHUB_REPO:  { value: 'my-org/my-repo' },
        GITHUB_BRANCH:{ value: 'main' },
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
              'yum install -y git awscli',
            ],
          },
          pre_build: {
            commands: [
              'git config --global user.name "AWS CodeBuild"',
              'git config --global user.email "codebuild@your-domain.com"',
              'echo Cloning GitHub repo...',
              'git clone https://$GITHUB_TOKEN@github.com/$GITHUB_REPO.git repo',
            ],
          },
          build: {
            commands: [
              'echo Downloading XLSX from S3...',
              'aws s3 cp s3://$SOURCE_BUCKET/report.xlsx repo/report.xlsx',
              'cd repo',
              'git add report.xlsx',
              'git commit -m "Add XLSX from S3 via CodePipeline" || echo "no changes to commit"',
              'git push origin $GITHUB_BRANCH',
            ],
          },
        },
      }),
    });

    // … grant githubSecret.read to buildProject, and add build stage …
  }
}