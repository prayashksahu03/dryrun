class ReturnException(Exception):
    def __init__(self, value):
        self.value = value

class BreakException(Exception):
    pass

class ContinueException(Exception):
    pass

class SegFaultError(Exception):
    def __init__(self, kind: str, message: str, address=None, line=None):
        self.kind = kind
        self.message = message
        self.address = address
        self.line = line
