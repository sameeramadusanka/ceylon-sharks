# GitHub Actions OIDC deploy role

IAM resources that let `.github/workflows/deploy-availability.yml` deploy
without any long-lived AWS access keys. These are **not** created by
`template.yaml` - they're prerequisites for the deploy workflow itself
(a workflow can't deploy the role it needs to assume), so they're set up
once via the AWS CLI and tracked here only as a reference/reproduction
record, not as auto-applied infrastructure.

- `trust-policy.json` - who can assume the role (GitHub Actions, only for
  this repo). The `sub` condition uses `sameeramadusanka*/ceylon-sharks*`
  (not an exact match) because GitHub's OIDC token includes immutable
  numeric IDs after the owner and repo name
  (`repo:sameeramadusanka@30517747/ceylon-sharks@1359877297:ref:...`),
  confirmed via `aws cloudtrail lookup-events
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity`
  after the first real deploy attempt failed with
  `Not authorized to perform sts:AssumeRoleWithWebIdentity`.
- `permissions-policy.json` - what the role can do once assumed: scoped by
  resource-name prefix per AWS service wherever the action supports it,
  plus two things that can't be scoped by name and are required for any
  SAM deploy regardless of stack:
  - `cloudformation:ValidateTemplate` on `*` (no resource-level support)
  - `cloudformation:CreateChangeSet` on
    `arn:aws:cloudformation:ap-southeast-1:aws:transform/Serverless-2016-10-31`
    - the AWS-owned SAM transform macro every `AWS::Serverless-2016-10-31`
      template uses. Missing this produced:
      `... is not authorized to perform: cloudformation:CreateChangeSet on
      resource: arn:...:aws:transform/Serverless-2016-10-31` on the first
      real deploy.

Both files are kept identical to what's actually live - verified with:

```bash
diff <(aws iam get-role --role-name ceylon-sharks-availability-deploy \
  --query 'Role.AssumeRolePolicyDocument') trust-policy.json

diff <(aws iam get-role-policy --role-name ceylon-sharks-availability-deploy \
  --policy-name deploy-permissions --query 'PolicyDocument') permissions-policy.json
```

## (Re)creating from scratch

```bash
# One-time per AWS account - skip if the provider already exists.
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --region ap-southeast-1

aws iam create-role \
  --role-name ceylon-sharks-availability-deploy \
  --assume-role-policy-document file://trust-policy.json \
  --description "GitHub Actions OIDC deploy role for ceylon-sharks-availability (backend/infrastructure CI deploys)"

aws iam put-role-policy \
  --role-name ceylon-sharks-availability-deploy \
  --policy-name deploy-permissions \
  --policy-document file://permissions-policy.json
```

## Updating permissions

Edit `permissions-policy.json`, then re-apply with the same
`put-role-policy` command above (it replaces the policy in full). Update
this file first, then apply - don't apply ad hoc changes via the CLI and
let this file drift out of sync with what's actually live again.
