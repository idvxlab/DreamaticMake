"""Display colors are sRGB values, independent of physical material properties."""
from typing import Annotated
from pydantic import Field

ColorHex = Annotated[str, Field(pattern=r'^#[0-9a-fA-F]{6}$')]
