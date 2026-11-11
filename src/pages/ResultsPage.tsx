import { useState, useMemo } from 'react';
import { PAGE_MAX_WIDTH } from '../theme';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '../components/buttons/IconButton';
import TextButton from '../components/buttons/TextButton';
import ImportExportDialog from '../components/toolbar/ImportExportDialog';
import type { OptimizeResponse } from '../types/api';
import { useGemData } from '../contexts/useGemData';
import { encodeSetup } from '../utils/setupCodec';
import { SLOT_ORDER } from '../utils/gearAssets';
import { buildResultCodecState } from '../utils/resultsExport';
import { LOGO_URL } from '../utils/publicAssets';
import SummaryCard from '../components/results/SummaryCard';
import UpgradesSection from '../components/results/UpgradesSection';
import GearSlotResult from '../components/results/GearSlotResult';
import RemainingInventory from '../components/results/RemainingInventory';
import ConvertedGemsSection from '../components/results/ConvertedGemsSection';
import DormantGemsSection from '../components/results/DormantGemsSection';

interface LocationState {
  optimizeResponse: OptimizeResponse;
}

function isValidState(state: unknown): state is LocationState {
  return state !== null && typeof state === 'object' && 'optimizeResponse' in (state as object);
}

export default function ResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { gemById } = useGemData();
  const [exportOpen, setExportOpen] = useState(false);

  const state = isValidState(location.state) ? location.state : null;

  const exportCode = useMemo(
    () => (exportOpen && state ? encodeSetup(buildResultCodecState(state.optimizeResponse)) : ''),
    [exportOpen, state],
  );

  if (!state) {
    return <Navigate to="/" replace />;
  }

  const { summary, gem_results, upgrades, remaining_inventory, converted_gems, dormant_gems, activated_dormant_gems } =
    state.optimizeResponse;

  return (
    <Box sx={{ width: PAGE_MAX_WIDTH, maxWidth: '100%', mx: 'auto' }}>
      {/* Mobile header */}
      <Box sx={{ display: { xs: 'flex', md: 'none' }, flexDirection: 'column', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box component="img" src={LOGO_URL} onClick={() => navigate('/')} sx={{ height: 66, width: 'auto', cursor: 'pointer' }} />
          <Typography variant="h5" sx={{ fontWeight: 'bold', lineHeight: 1 }}>
            Optimization Results
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <IconButton size="xxs" variant="secondary" icon="return" onClick={() => navigate('/')} />
          <TextButton size="s" variant="secondary" scale={0.7} onClick={() => setExportOpen(true)}>
            Export
          </TextButton>
        </Box>
      </Box>

      {/* Desktop header */}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <IconButton size="xxs" variant="secondary" icon="return" onClick={() => navigate('/')} />
          <Typography variant="h5" sx={{ fontWeight: 'bold', lineHeight: 1 }}>
            Optimization Results
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <TextButton size="s" variant="secondary" scale={0.7} onClick={() => setExportOpen(true)}>
            Export
          </TextButton>
          <Box component="img" src={LOGO_URL} onClick={() => navigate('/')} sx={{ height: 66, width: 'auto', cursor: 'pointer' }} />
        </Box>
      </Box>
      <Stack spacing={3}>
        <SummaryCard summary={summary} />

        {(dormant_gems?.some((d) => d.quantity > 0) || (activated_dormant_gems?.length ?? 0) > 0) && (
          <DormantGemsSection dormantGems={dormant_gems ?? []} activatedGems={activated_dormant_gems ?? []} />
        )}

        {converted_gems && converted_gems.length > 0 && <ConvertedGemsSection convertedGems={converted_gems} />}

        {upgrades && upgrades.upgrades_applied.length > 0 && <UpgradesSection upgrades={upgrades} />}

        <Box>
          <Typography variant="h6" gutterBottom>
            Gear Slots
          </Typography>
          <Stack spacing={2}>
            {SLOT_ORDER.map((slot) => {
              const result = gem_results[slot];
              if (!result) return null;
              return <GearSlotResult key={slot} slotName={slot} slotResult={result} />;
            })}
          </Stack>
        </Box>

        <RemainingInventory items={remaining_inventory} dormantGems={dormant_gems ?? []} />
      </Stack>

      <ImportExportDialog
        open={exportOpen}
        mode="export"
        exportCode={exportCode}
        gemById={gemById}
        onImport={() => {}}
        onClose={() => setExportOpen(false)}
      />
    </Box>
  );
}
