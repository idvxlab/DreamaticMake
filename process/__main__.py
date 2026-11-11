"""Describe supported v3 tasks. Project context is prepared through harness."""
import argparse
import json
from .tasks import TASK_KINDS, describe_task


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('list', 'schema'))
    parser.add_argument('kind', nargs='?')
    args = parser.parse_args()
    if args.command == 'schema' and args.kind not in TASK_KINDS:
        parser.error('Choose a supported task kind from process list')
    value = list(TASK_KINDS) if args.command == 'list' else describe_task(args.kind)
    print(json.dumps(value, ensure_ascii=True))


if __name__ == '__main__':
    main()
