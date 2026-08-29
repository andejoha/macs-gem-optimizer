import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import type { ActivatedGemItem, DormantGemItem } from '../../types/api';
import { useGemData } from '../../contexts/useGemData';
import { getGemImageUrl } from '../../utils/gearAssets';
import { gemPowerIcon } from '../../utils/inventoryAssets';
import { formatRank } from '../../utils/rankUtils';
import arrowBackwardIcon from '../../assets/images/buttons/arrow-backward.png';

interface Props {
  dormantGems: DormantGemItem[];
  activatedGems: ActivatedGemItem[];
}

/** A labeled total gem power figure, e.g. "Total recovered: +120". */
function TotalPowerLine({ label, amount, sign }: { label: string; amount: number; sign: '+' | '-' }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box component="img" src={gemPowerIcon} sx={{ width: 16, height: 16 }} />
      <Typography variant="body1" fontWeight={600} color={sign === '+' ? 'success.main' : 'error.main'}>
        {sign}
        {amount.toLocaleString()}
      </Typography>
    </Box>
  );
}

/**
 * One gem tile showing its identity, rank, copy count, and a signed gem
 * power figure. The arrow points toward the gem power icon for a gain
 * (power flowing out to the pool) and away from it for a cost (power
 * flowing out of the pool into the gem).
 */
function GemPowerTile({
  gemId,
  rank,
  starRating,
  quantity,
  powerAmount,
  sign,
  grayscale,
}: {
  gemId: number;
  rank: string;
  starRating: number;
  quantity: number;
  powerAmount: number;
  sign: '+' | '-';
  grayscale?: boolean;
}) {
  const { gemById } = useGemData();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'action.hover' }}>
      <Box component="img" src={getGemImageUrl(gemId)} sx={{ width: 32, height: 32, ...(grayscale && { filter: 'grayscale(1)' }) }} />
      <Box>
        <Typography variant="body2">{gemById.get(gemId)?.name ?? String(gemId)}</Typography>
        <Typography variant="caption" color="text.secondary">
          {formatRank(rank, starRating)}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            ×{quantity}
          </Typography>
          <Box component="img" src={arrowBackwardIcon} sx={{ width: 12, height: 12, ...(sign === '+' && { transform: 'scaleX(-1)' }) }} />
          <Box component="img" src={gemPowerIcon} sx={{ width: 14, height: 14 }} />
          <Typography variant="body2" fontWeight={600} color={sign === '+' ? 'success.main' : 'error.main'}>
            {sign}
            {powerAmount}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

export default function DormantGemsSection({ dormantGems, activatedGems }: Props) {
  // Gems already dormant on input that are still unused are no-ops for the
  // player — only show entries that represent a new recommendation.
  const newlyDormant = dormantGems.filter((item) => item.quantity > 0);
  if (newlyDormant.length === 0 && activatedGems.length === 0) return null;

  const totalGained = newlyDormant.reduce((sum, item) => sum + item.gem_power_gained, 0);
  const totalActivationCost = activatedGems.reduce((sum, item) => sum + item.gem_power_cost, 0);

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h6">Dormant Gems</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {activatedGems.length > 0 && <TotalPowerLine label="Total activation cost:" amount={totalActivationCost} sign="-" />}
            {newlyDormant.length > 0 && <TotalPowerLine label="Total recovered:" amount={totalGained} sign="+" />}
          </Box>
        </Box>
        <Divider sx={{ mb: 2 }} />
        {activatedGems.length > 0 && (
          <>
            <Typography variant="subtitle2" gutterBottom>
              Recommended to Activate
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: newlyDormant.length > 0 ? 2 : 0 }}>
              {activatedGems.map((item) => (
                <GemPowerTile
                  key={`${item.gem_id}|${item.rank}|${item.active_stars}`}
                  gemId={item.gem_id}
                  rank={item.rank}
                  starRating={item.star_rating}
                  quantity={item.quantity}
                  powerAmount={item.gem_power_cost}
                  sign="-"
                />
              ))}
            </Box>
          </>
        )}
        {newlyDormant.length > 0 && (
          <>
            {activatedGems.length > 0 && <Divider sx={{ mb: 2 }} />}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {newlyDormant.map((item) => (
                <GemPowerTile
                  key={`${item.gem_id}|${item.rank}|${item.active_stars}`}
                  gemId={item.gem_id}
                  rank={item.rank}
                  starRating={item.star_rating}
                  quantity={item.quantity}
                  powerAmount={item.gem_power_gained}
                  sign="+"
                  grayscale
                />
              ))}
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
