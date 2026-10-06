export function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="cardGrid skeletonCardGrid" aria-label="Loading cards">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeletonCard" key={index}>
          <div className="skeleton skeletonCardImage" />
          <div className="skeletonCardText">
            <span className="skeleton skeletonLine wide" />
            <span className="skeleton skeletonLine medium" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ListSkeleton({
  rows = 4,
  compact = false,
}: {
  rows?: number
  compact?: boolean
}) {
  return (
    <div className={`listSkeleton ${compact ? "compact" : ""}`} aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div className="listSkeletonRow" key={index}>
          <span className="skeleton skeletonAvatar" />
          <div>
            <span className="skeleton skeletonLine wide" />
            <span className="skeleton skeletonLine medium" />
          </div>
          <span className="skeleton skeletonButton" />
        </div>
      ))}
    </div>
  )
}

export function NotificationSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="listSkeleton notificationSkeleton" aria-label="Loading notifications">
      {Array.from({ length: rows }, (_, index) => (
        <div className="listSkeletonRow" key={index}>
          <div>
            <span className="skeleton skeletonLine medium" />
            <span className="skeleton skeletonLine wide" />
          </div>
          <span className="skeleton skeletonButton" />
        </div>
      ))}
    </div>
  )
}
