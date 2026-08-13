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
    id:          Optional[int] = Field(default=None, primary_key=True)
    room_id:     int           = Field(foreign_key="game_rooms.id")
    pseudo:      str
    score:       int           = Field(default=0)
    # uid cooloss si le joueur était connecté (via le cookie partagé,
    # vérifié côté serveur — jamais déduit du pseudo envoyé par le client).
    # NULL pour les invités, comme pour toutes les parties d'avant cette
    # colonne.
    account_uid: Optional[int] = Field(default=None)


class GameRound(SQLModel, table=True):
    __tablename__  = "game_rounds"
    __table_args__ = {"extend_existing": True}
    id:        Optional[int]                     = Field(default=None, primary_key=True)
    room_id:   int                                = Field(foreign_key="game_rooms.id")
    round_num: int           # 0, 1, 2
    # Horodatage de la partie (identique pour les 3 rounds d'une même partie),
    # utilisé pour regrouper la timeline par partie plutôt que par room (une
    # room peut être rejouée plusieurs fois). NULL pour les parties jouées
    # avant l'ajout de cette colonne — fallback sur GameRoom.created_at.
    played_at: Optional[datetime.datetime]        = Field(default=None)


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
    # Même uid cooloss que GamePlayer.account_uid, dupliqué ici pour pouvoir
    # requêter "légendes de tel compte" sans jointure. NULL pour un invité.
    account_uid:   Optional[int] = Field(default=None)
    # Modération (voir legend_moderation.py) : visibility est le flag
    # autoritaire consulté partout où une légende est exposée publiquement.
    # Défaut "private" — rien n'est exposé tant que non revu (par l'IA ou un
    # admin). ai_label/ai_reason gardent la dernière classification Gemini
    # pour affichage admin, séparément de visibility qui peut avoir été
    # ensuite corrigée à la main. reviewed=True dès qu'un admin a tranché
    # manuellement, pour que la classification batch ne l'écrase plus.
    visibility:    str            = Field(default="private")  # "public" | "private"
    ai_label:      Optional[str]  = Field(default=None)       # "public" | "private" | None (pas encore classifié)
    ai_reason:     Optional[str]  = Field(default=None)
    reviewed:      bool           = Field(default=False)


class GameVote(SQLModel, table=True):
    __tablename__  = "game_votes"
    __table_args__ = {"extend_existing": True}
    id:              Optional[int] = Field(default=None, primary_key=True)
    answer_id:       int           = Field(foreign_key="game_answers.id")
    voter_player_id: int           = Field(foreign_key="game_players.id")
    stars:           int           # 1-5
