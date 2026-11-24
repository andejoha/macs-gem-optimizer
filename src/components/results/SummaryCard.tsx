import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import type { SummaryResponse } from '../../types/api';
import { gemPowerIcon } from '../../utils/inventoryAssets';
import resonanceIcon from '../../assets/images/resonance.png';

interface Props {
  summary: SummaryResponse;
}

/** A prominent value with an icon and a caption underneath. */
function HeadlineStat({ icon, value, label, color }: { icon: string; value: string; label: string; color?: string }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="img" src={icon} sx={{ width: 32, height: 32 }} />
        <Typography variant="h4" color={color ?? 'text.primary'} sx={{ fontWeight: 700, lineHeight: 1 }}>
          {value}
        </Typography>
      </Box>
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5 }}>
        {label}
      </Typography>
    </Box>
  );
}

/** A one-sentence explanation of what the surplus or shortfall means for the player. */
function describeSurplus(surplus: number): string {
  if (surplus < 0) return `You need ${Math.abs(surplus).toLocaleString()} more gem power to fill every socket.`;
  if (surplus === 0) return 'Your gem power exactly covers every socket.';
  return `Your gem power covers every socket with ${surplus.toLocaleString()} to spare.`;
}

/** Summary of an optimization run, leading with whether the result is feasible. */
export default function SummaryCard({ summary }: Props) {
  const surplus = summary.surplus_or_shortfall;
  const feasible = summary.status === 'feasible';
  const statusColor = feasible ? 'success' : 'error';
  const StatusIcon = feasible ? CheckCircleIcon : ErrorIcon;
  const surplusText = `${surplus >= 0 ? '+' : '−'}${Math.abs(surplus).toLocaleString()}`;

  return (
    <Card
      sx={(theme) => ({
        border: 2,
        borderColor: theme.palette[statusColor].main,
        backgroundImage: 'none',
        bgcolor: alpha(theme.palette[statusColor].main, 0.08),
      })}
    >
      <CardContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 0.5, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <StatusIcon color={statusColor} sx={{ fontSize: 36 }} />
            <Typography variant="h4" color={`${statusColor}.main`} sx={{ fontWeight: 700 }}>
              {feasible ? 'Feasible' : 'Shortfall'}
            </Typography>
          </Box>
          <Typography variant="body1" color="text.secondary">
            {describeSurplus(surplus)}
          </Typography>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <HeadlineStat icon={resonanceIcon} value={summary.total_resonance.toLocaleString()} label="Total Resonance" />
          <HeadlineStat
            icon={gemPowerIcon}
            value={surplusText}
            label={surplus >= 0 ? 'Surplus' : 'Shortfall'}
            color={`${statusColor}.main`}
          />
        </Box>
      </CardContent>
    </Card>
  );
}
