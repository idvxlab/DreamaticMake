"""Host-injected read-only library tools. No agent runtime, approvals or user paths in calls."""
from element.library.retrieval import ElementRetriever
from element.schema.retrieval import RetrievalQuery, RetrievalRef


class ElementSearchTool:
    def __init__(self, retriever: ElementRetriever):
        self.retriever = retriever

    def describe(self):
        return {'tools': [
            {'name': 'element_search', 'description': '按自然语言、类别和精确参数检索元件；返回候选、证据和准入缺口。',
             'input_schema': RetrievalQuery.model_json_schema()},
            {'name': 'element_inspect', 'description': '按搜索结果的精确引用读取参数、条件、来源和可选用的原生定义。',
             'input_schema': RetrievalRef.model_json_schema()},
            {'name': 'element_categories', 'description': '查看库中类别、数量、参数代码和检索词汇。',
             'input_schema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
        ]}

    def call(self, name, arguments):
        if name == 'element_search': return self.retriever.search(arguments).model_dump(mode='json')
        if name == 'element_inspect': return self.retriever.get(arguments)
        if name == 'element_categories':
            if arguments != {}: raise ValueError('element_categories takes no arguments')
            return self.retriever.describe()
        raise ValueError('Unknown element tool')


def dispatch_element_search(method, payload, retriever):
    return ElementSearchTool(retriever).call(method, payload)
