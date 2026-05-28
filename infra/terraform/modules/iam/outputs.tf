output "execution_role_arn"  { value = aws_iam_role.execution.arn }
output "task_role_arn"       { value = aws_iam_role.task.arn }
output "github_deploy_role_arn" {
  value = var.create_github_deploy_role ? aws_iam_role.github_deploy[0].arn : null
}
