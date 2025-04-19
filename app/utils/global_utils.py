def log(msg: str, module_name: str = "global_utils"):
    print(f"[{module_name}] {msg}")

import pprint
def pretty_print_api_response(response_data):
    pp = pprint.PrettyPrinter(indent=2, width=100)
    pp.pprint(response_data)
