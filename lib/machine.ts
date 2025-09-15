'use client'
import { create } from 'zustand'

type State = 'idle' | 'recording' | 'thinking' | 'playing' | 'readyToContinue' | 'doneSuccess'

type Store = {
  state: State
  label: string
  disabled: boolean
  debugLog: string[]
  elapsedMs?: number
  primary: () => void
  setDisabled: (v:boolean)=>void
  toDone: ()=>void
  pushLog: (s:string)=>void
}

function computeLabel(state: State): string {
  switch(state){
    case 'idle': return 'Start'
    case 'recording': return 'Done'
    case 'thinking': return 'Cancel'
    case 'playing': return 'Continue'
    case 'readyToContinue': return 'Continue'
    case 'doneSuccess': return 'Start Again'
  }
}

export const useInterviewMachine = create<Store>((set, get) => ({
  state: 'idle',
  label: 'Start',
  disabled: false,
  debugLog: ['Ready'],
  elapsedMs: 0,
  setDisabled: (v)=> set({ disabled: v }),
  toDone: ()=> set({ state: 'doneSuccess', label: computeLabel('doneSuccess'), disabled: false }),
  pushLog: (s)=> set(state => ({ debugLog: [...state.debugLog, s] })),
  primary: () => {
    const { state, disabled } = get()
    if (disabled) return
    const push = (msg:string)=> set(s=>({debugLog:[...s.debugLog, msg]}))
    if (state === 'idle') {
      set({ state: 'recording', label: computeLabel('recording') })
      push('Recording started')
      return
    }
    if (state === 'recording') {
      set({ state: 'thinking', label: computeLabel('thinking'), disabled: true })
      push('Recording stopped → thinking')
      setTimeout(()=>{
        set({ state: 'playing', label: computeLabel('playing'), disabled: false })
        push('Assistant reply ready → playing')
      }, 600)
      return
    }
    if (state === 'thinking') {
      set({ state: 'readyToContinue', label: computeLabel('readyToContinue'), disabled: false })
      push('Cancelled thinking')
      return
    }
    if (state === 'playing') {
      set({ state: 'readyToContinue', label: computeLabel('readyToContinue') })
      push('Finished playing → ready')
      return
    }
    if (state === 'readyToContinue') {
      set({ state: 'recording', label: computeLabel('recording') })
      push('Continue → recording')
      return
    }
    if (state === 'doneSuccess') {
      set({ state: 'idle', label: computeLabel('idle') })
      push('Start again → idle')
      return
    }
  }
}))
