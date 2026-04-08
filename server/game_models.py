"""
Modèles SQLModel pour le jeu de mèmes.
"""
import datetime
from typing import Optional
from sqlmodel import SQLModel, Field


class GameRoom(SQLModel, table=True):
    __tablename__   = "game_rooms"
    __table_args__  = {"extend_existing": True}
    id:          Optional[int]     = Field(default=None, primary_key=True)
    code:        str               = Field(index=True)
    host_pseudo: str
    status:      str               = Field(default="lobby")  # lobby|playing|finished
    created_at:  datetime.datetime = Field(default_factory=datetime.datetime.utcnow)


class GamePlayer(SQLModel, table=True):
    __tablename__  = "game_players"
    __table_args__ = {"extend_existing": True}
    id:      Optional[int] = Field(default=None, primary_key=True)
    room_id: int           = Field(foreign_key="game_rooms.id")
    pseudo:  str
    score:   int           = Field(default=0)


class GameRound(SQLModel, table=True):
    __tablename__  = "game_rounds"
    __table_args__ = {"extend_existing": True}
    id:        Optional[int] = Field(default=None, primary_key=True)
    room_id:   int           = Field(foreign_key="game_rooms.id")
    round_num: int           # 0, 1, 2


class GameAnswer(SQLModel, table=True):
    __tablename__  = "game_answers"
    __table_args__ = {"extend_existing": True}
    id:            Optional[int] = Field(default=None, primary_key=True)
    round_id:      int           = Field(foreign_key="game_rounds.id")
    player_id:     int           = Field(foreign_key="game_players.id")
    player_pseudo: str           = Field(default="")
    media_uuid:    str
    text:          str           = Field(default="")
    reveal_order:  int           = Field(default=0)
    total_stars:   int           = Field(default=0)
    vote_count:    int           = Field(default=0)


class GameVote(SQLModel, table=True):
    __tablename__  = "game_votes"
    __table_args__ = {"extend_existing": True}
    id:              Optional[int] = Field(default=None, primary_key=True)
    answer_id:       int           = Field(foreign_key="game_answers.id")
    voter_player_id: int           = Field(foreign_key="game_players.id")
    stars:           int           # 1-5
