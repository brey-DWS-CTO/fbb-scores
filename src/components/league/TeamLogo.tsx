import { teamFullName, teamLogoUrl } from '../../lib/league/houseParty.js';

interface Props {
  code: string | null;
  size?: number;
  className?: string;
}

/** An NBA team's logo from ESPN, or an empty ring when there is no team. */
export default function TeamLogo({ code, size = 28, className }: Props) {
  if (!code) {
    return <span className={`team-logo team-logo-empty${className ? ` ${className}` : ''}`} style={{ width: size, height: size }} aria-hidden="true" />;
  }
  return (
    <img
      className={`team-logo${className ? ` ${className}` : ''}`}
      src={teamLogoUrl(code)}
      alt={teamFullName(code)}
      title={teamFullName(code)}
      width={size}
      height={size}
      loading="lazy"
    />
  );
}
