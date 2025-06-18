import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as cpactions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';

export class S3ToCodeBuildPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Source bucket
    const sourceBucket = s3.Bucket.fromBucketName(this, 'SourceBucket', 'your-existing-s3-bucket-name');

    // Artifact buckets (for passing artifacts between stages)
    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();

    // CodeBuild project
    const buildProject = new codebuild.PipelineProject(this, 'MyBuildProject', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: ['echo Installing...'],
          },
          build: {
            commands: ['echo Building project...', 'ls -la'],
          },
        },
        artifacts: {
          'files': ['**/*'],
        },
      }),
    });

    // The pipeline
    new codepipeline.Pipeline(this, 'S3ToBuildPipeline', {
      pipelineName: 'MyS3ToCodeBuildPipeline',
      stages: [
        {
          stageName: 'Source',
          actions: [
            new cpactions.S3SourceAction({
              actionName: 'S3_Source',
              bucket: sourceBucket,
              bucketKey: 'path/to/your/source.zip', // S3 object key
              output: sourceOutput,
              trigger: cpactions.S3Trigger.EVENTS, // or .POLL or .NONE
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new cpactions.CodeBuildAction({
              actionName: 'BuildAction',
              project: buildProject,
              input: sourceOutput,
              outputs: [buildOutput],
            }),
          ],
        },
      ],
    });
  }
}
