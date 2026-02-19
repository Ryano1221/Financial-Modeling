"""SQLAlchemy models mirroring Prisma schema. Use Alembic for migrations."""
from __future__ import annotations

import enum
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, LargeBinary
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from .session import Base


class Role(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    member = "member"


class JobType(str, enum.Enum):
    pdf_export = "pdf_export"
    lease_extraction = "lease_extraction"


class JobStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(String, primary_key=True)
    clerk_org_id = Column("clerk_org_id", String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    stripe_customer_id = Column("stripe_customer_id", String, nullable=True)
    created_at = Column("created_at", DateTime, default=datetime.utcnow)
    updated_at = Column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    members = relationship("OrganizationMember", back_populates="organization")
    deals = relationship("Deal", back_populates="organization")
    audit_logs = relationship("AuditLog", back_populates="organization")
    branding = relationship("OrganizationBranding", back_populates="organization", uselist=False)


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    clerk_id = Column("clerk_id", String, unique=True, nullable=False)
    email = Column(String, nullable=True)
    name = Column(String, nullable=True)
    created_at = Column("created_at", DateTime, default=datetime.utcnow)
    updated_at = Column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    memberships = relationship("OrganizationMember", back_populates="user")


class OrganizationMember(Base):
    __tablename__ = "organization_members"

    id = Column(String, primary_key=True)
    organization_id = Column("organization_id", String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column("user_id", String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, nullable=False, default=Role.member.value)
    created_at = Column("created_at", DateTime, default=datetime.utcnow)
    updated_at = Column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    organization = relationship("Organization", back_populates="members")
    user = relationship("User", back_populates="memberships")


class Deal(Base):
    __tablename__ = "deals"

    id = Column(String, primary_key=True)
    organization_id = Column("organization_id", String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    metadata_ = Column("metadata", JSONB, default=dict)
    created_at = Column("created_at", DateTime, default=datetime.utcnow)
    updated_at = Column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    organization = relationship("Organization", back_populates="deals")
    scenarios = relationship("Scenario", back_populates="deal")


class Scenario(Base):
    __tablename__ = "scenarios"

    id = Column(String, primary_key=True)
    deal_id = Column("deal_id", String, ForeignKey("deals.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    payload = Column(JSONB, nullable=False)
    created_at = Column("created_at", DateTime, default=datetime.utcnow)
    updated_at = Column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    deal = relationship("Deal", back_populates="scenarios")
    runs = relationship("Run", back_populates="scenario")


class Run(Base):
    __tablename__ = "runs"

    id = Column(String, primary_key=True)
    scenario_id = Column("scenario_id", String, ForeignKey("scenarios.id", ondelete="CASCADE"), nullable=False)
    result = Column(JSONB, nullable=False)
    created_at = Column("created_at", DateTime, default=datetime.utcnow)

    scenario = relationship("Scenario", back_populates="runs")


class Report(Base):
    __tablename__ = "reports"

    id = Column(String, primary_key=True)
    organization_id = Column("organization_id", String, nullable=False)
    payload = Column(JSONB, nullable=False)
    s3_key = Column("s3_key", String, nullable=True)
    job_id = Column("job_id", String, nullable=True)
    created_at = Column("created_at", DateTime, default=datetime.utcnow)
    updated_at = Column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class File(Base):
    __tablename__ = "files"

    id = Column(String, primary_key=True)
    organization_id = Column("organization_id", String, nullable=False)
    filename = Column(String, nullable=False)
    s3_key = Column("s3_key", String, nullable=False)
    content_type = Column("content_type", String, nullable=False)
    job_id = Column("job_id", String, nullable=True)
    created_at = Column("created_at", DateTime, default=datetime.utcnow)


class Job(Base):
    __tablename__ = "jobs"

    id = Column(String, primary_key=True)
    organization_id = Column("organization_id", String, nullable=False)
    type = Column(String, nullable=False)  # JobType value
    status = Column(String, nullable=False, default=JobStatus.pending.value)
    payload = Column(JSONB, nullable=True)
    result_s3_key = Column("result_s3_key", String, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column("created_at", DateTime, default=datetime.utcnow)
    completed_at = Column("completed_at", DateTime, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(String, primary_key=True)
    organization_id = Column("organization_id", String, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    actor_id = Column("actor_id", String, nullable=False)
    action = Column(String, nullable=False)
    resource_type = Column("resource_type", String, nullable=False)
    resource_id = Column("resource_id", String, nullable=True)
    details = Column(JSONB, nullable=True)
    created_at = Column("created_at", DateTime, default=datetime.utcnow)

    organization = relationship("Organization", back_populates="audit_logs")


class OrganizationBranding(Base):
    __tablename__ = "organization_branding"

    id = Column(String, primary_key=True)
    organization_id = Column(
        "organization_id",
        String,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    logo_bytes = Column("logo_bytes", LargeBinary, nullable=True)
    logo_content_type = Column("logo_content_type", String, nullable=True)
    logo_filename = Column("logo_filename", String, nullable=True)
    logo_sha256 = Column("logo_sha256", String, nullable=True)
    logo_updated_at = Column("logo_updated_at", DateTime, nullable=True)
    created_at = Column("created_at", DateTime, default=datetime.utcnow)
    updated_at = Column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    organization = relationship("Organization", back_populates="branding")
