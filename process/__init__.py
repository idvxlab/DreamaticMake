"""Task contracts and validation for harness; reference material lives in project doc/."""
from .tasks import (TaskSpec, TaskResult, describe_task, plan_tasks, prepare_task,
                    validate_deliverable, integrate_deliverable, assess_acceptance)

__all__ = ['TaskSpec', 'TaskResult', 'describe_task', 'plan_tasks', 'prepare_task',
           'validate_deliverable', 'integrate_deliverable', 'assess_acceptance']
